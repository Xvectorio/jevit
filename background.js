// Clicking a JevIt notification opens the manager, where the key and consent are set.
// Automatic triage runs on every new mail: show each kind of problem once per session, not each time.
// `reason` groups messages that differ only in details (counts, server replies).
const notified = new Set();
let shown = Promise.resolve(); // one notification call at a time, so they arrive in order
function notify(message, manual, reason = message) {
  if (!manual && notified.has(reason)) return;
  if (!manual) notified.add(reason);
  // Some desktops stack notifications with the same id instead of replacing them: clear the old one first.
  shown = shown.then(() => messenger.notifications.clear("jevit"))
    .then(() => messenger.notifications.create("jevit", { type: "basic", title: "JevIt", message: message.slice(0, 250) }))
    .catch(console.error);
}
messenger.notifications.onClicked.addListener((id) => id === "jevit" && messenger.runtime.openOptionsPage());

// The last errors, newest first, for the manager's "Recent errors" card: notifications are cut off and gone.
let logged = Promise.resolve(); // one write at a time, so parallel triage doesn't drop entries
function logError(what, e) {
  console.error("JevIt:", what, e);
  const entry = { at: Date.now(), what, message: String(e?.message ?? e) };
  logged = logged.then(async () => {
    const { errors = [] } = await messenger.storage.local.get("errors");
    await messenger.storage.local.set({ errors: [entry, ...errors].slice(0, 50) });
  }).catch(console.error);
}

async function triageList(list, manual) {
  const s = await loadSettings();
  const missing = connectionProblem(s); // a used-up budget halts in classify(), once a mail needs a request: stored scores are still free
  if (missing) return notify(`Can't triage with Jev: ${missing}. Click here to open the JevIt manager.`, manual);
  await syncTags(s);
  let failed = 0, skipped = 0, excluded = 0, moved = 0, judged = 0, free = 0, review = 0, firstError, halted, stopped;
  const matched = new Map(); // recipe key -> mails it matched
  running++;
  const { signal } = stopping; // the toolbar button's Stop; it also aborts requests on their way (classify)
  try {
    // A few mails at a time, all pulling from one list; a break in one ends the list for all.
    // ponytail: fixed 4 in flight (~4 req/s, well under the 1200 req/min limit); 429s back off in askJev
    const messages = iterate(list);
    await Promise.all(Array.from({ length: 4 }, async () => {
      for await (const m of messages) {
        if (signal.aborted) break;
        if (s.excludedAccounts.includes(m.folder?.accountId)) {
          excluded++;
          continue;
        }
        try {
          // Only for mail you pick: new mail can't have been triaged yet, so a Triaged tag on it didn't come from JevIt.
          // The tag can be turned off, so stored scores count too (for SCORE_DAYS). Inside try: one unreadable mail fails alone.
          if (manual && s.skipTriaged && (m.tags.includes(TRIAGED.key) || (await onMessage(m, (id) => judgedBefore(id, s.bodyChars, s.endpoint))))) {
            skipped++;
            continue;
          }
          const { key, retry, keys, answers, act, unsure, paid } = await onMessage(m, (id) => classify(id, s, signal));
          // Its scores are stored by now. If the mail isn't tagged and moved after all, they're marked so the next
          // triage doesn't skip it as done; they're reused, so that's free.
          try {
            await allowed(s, signal); // a Stop, or consent unticked, while Jev answered: leave the mail as it was
            await onMessage(m, (id) => applyRecipes(id, s.recipes, keys, answers, s.triagedTag, { act, unsure }));
          } catch (e) {
            await markRetry(key, true).catch(console.error);
            throw e;
          }
          if (retry) await markRetry(key, false).catch(console.error);
          judged++, free += !paid, review += unsure;
          for (const k of keys) matched.set(k, (matched.get(k) ?? 0) + 1);
        } catch (e) {
          if (e.cause === "stop") break; // you stopped it: not an error
          if (e.cause === "halt") {
            halted = e;
            logError("Triage stopped", e);
            break;
          }
          // Moved away while JevIt worked on it: new mail often goes to Junk a few seconds after it arrives.
          if (e.cause === "gone") moved++, console.info("JevIt: left alone,", m.subject, e.message);
          else failed++, (firstError ??= e), logError(m.subject || "(no subject)", e);
        }
        done++;
        showBudgetBadge().catch(console.error);
      }
    }));
    stopped = signal.aborted;
  } finally {
    if (!--running) done = 0, stopping = new AbortController();
    showBudgetBadge().catch(console.error);
  }
  if (manual) return notify(summary(s.recipes, { judged, free, review, matched, skipped, excluded, moved, failed, firstError, halted, stopped }), true);
  // Automatic triage stays quiet unless something is wrong.
  if (halted) notify(`Jev triage stopped: ${halted.message}`, manual, halted.message);
  if (failed) notify(`Jev triage failed for ${failed} mail(s): ${firstError.message}`, manual, firstError.message.split(":")[0]);
}

// One notification at the end of a triage you started: what happened, most important first
// (notifications replace each other, and long ones are cut off).
function summary(recipes, { judged, free, review, matched, skipped, excluded, moved, failed, firstError, halted, stopped }) {
  const hits = recipes.filter((r) => matched.has(r.key)).map((r) => `${r.name} ${matched.get(r.key)}`);
  return [
    `${stopped || halted ? "Stopped after" : "Triaged"} ${judged} mail(s)${hits.length ? `: ${hits.join(", ")}` : judged ? ", nothing matched" : ""}.`,
    halted && halted.message,
    failed && `${failed} failed: ${firstError.message}`,
    review && `${review} Unsure to review.`,
    free && `${free} from stored scores (free).`,
    skipped && `Skipped ${skipped} already triaged; untick “Skip already triaged mail” to redo them.`,
    excluded && `Skipped ${excluded} from excluded accounts.`,
    moved && `Left ${moved} alone that moved away meanwhile.`,
  ].filter(Boolean).join(" ");
}

// Selected mails become a yes/no example for one recipe, and its tag (plus action on yes) is applied.
// Mail from an excluded account is only tagged: examples ride along in every request to Jev.
async function teach(list, key, yes) {
  const s = await loadSettings();
  const r = s.recipes.find((r) => r.key === key);
  if (!r) return console.warn(`JevIt: no recipe with tag key ${key}`);
  await syncTags(s);
  for await (const m of iterate(list)) {
    if (!s.excludedAccounts.includes(m.folder?.accountId)) addExample(r, (await emailState(m.id)).email, yes);
    await applyRecipes(m.id, [r], yes ? [key] : [], {});
  }
  await messenger.storage.local.set({ recipes: s.recipes });
}

// Hand the selected mails to the manager page, which opens a new unsaved recipe with them as yes examples.
async function newRecipeFrom(list) {
  const { excludedAccounts } = await loadSettings();
  const draft = [];
  for await (const m of iterate(list)) if (!excludedAccounts.includes(m.folder?.accountId)) draft.push((await emailState(m.id)).email);
  if (!draft.length) return notify("Can't make a recipe from mail in accounts excluded in the JevIt manager: its examples would be sent to Jev.", true);
  await messenger.storage.local.set({ draft });
  messenger.runtime.openOptionsPage();
}

async function buildMenus() {
  const { recipes } = await loadSettings();
  await messenger.menus.removeAll();
  const add = (props) => messenger.menus.create({ contexts: ["message_list"], ...props });
  add({ id: "root", title: "JevIt", icons: { 16: "icon-32.png" } });
  add({ id: "triage", parentId: "root", title: "Triage with Jev" });
  add({ id: "sep1", parentId: "root", type: "separator" });
  for (const r of recipes) {
    const name = r.name.replaceAll("&", "&&");
    add({ id: `recipe:${r.key}`, parentId: "root", title: name });
    add({ id: `yes:${r.key}`, parentId: `recipe:${r.key}`, title: `This is ${name}` });
    add({ id: `no:${r.key}`, parentId: `recipe:${r.key}`, title: `This is not ${name}` });
  }
  add({ id: "sep2", parentId: "root", type: "separator" });
  add({ id: "new", parentId: "root", title: "New recipe from selected mail…" });
  add({ id: "help", parentId: "root", title: "JevIt help" });
}

messenger.menus.onClicked.addListener((info) => {
  const [what, key] = String(info.menuItemId).split(":");
  const list = info.selectedMessages;
  if (what === "triage") triageList(list, true).catch((e) => (logError("Triage", e), notify(`Jev triage failed: ${e.message}`, true)));
  if (what === "yes" || what === "no") teach(list, key, what === "yes").catch((e) => logError("Teaching Jev", e));
  if (what === "new") newRecipeFrom(list).catch((e) => logError("New recipe from mail", e));
  if (what === "help") messenger.tabs.create({ url: "help.html" });
});

// Keyboard shortcuts (change them under Add-ons → gear → Manage Extension Shortcuts).
async function selectedMessages(tab) {
  if (tab.type === "mail") return messenger.mailTabs.getSelectedMessages(tab.id);
  const shown = await messenger.messageDisplay.getDisplayedMessages(tab.id); // mail opened in its own tab/window
  return shown.messages ? shown : { messages: shown };
}

messenger.commands.onCommand.addListener(async (command, tab) => {
  const yes = { "teach-spam": true, "teach-not-spam": false }[command];
  if (yes !== undefined) teach(await selectedMessages(tab), "jev_spam", yes).catch((e) => logError("Teaching Jev", e));
});

// While triage runs, the toolbar button counts the mails done so far (the total isn't known up front:
// big selections arrive in pages), and clicking it stops the run. Otherwise it shows "$" while this month's budget is used up.
let running = 0, done = 0, stopping = new AbortController();
async function showBudgetBadge() {
  if (running) {
    await messenger.browserAction.setBadgeText({ text: String(done) });
    return messenger.browserAction.setTitle({ title: `JevIt: triaging… ${done} mail(s) done. Click to stop.` });
  }
  const s = await loadSettings();
  const out = budgetLeft(s, await loadUsage(), monthOf()) <= 0;
  await messenger.browserAction.setBadgeText({ text: out ? "$" : "" });
  await messenger.browserAction.setTitle({ title: out ? `JevIt: this month's budget of ${money(s.budget)} is used up` : "JevIt" });
}

// Keep menus and tag colours current. Tag colours follow the colour set, or Thunderbird's theme on "auto".
const resyncTags = async () => syncTags(await loadSettings()).catch((e) => logError("Tag sync", e));
// The popup's requests are counted here too: usage changes on this page only (countUsage).
messenger.runtime.onMessage.addListener((message) => message?.countUsage && countUsage(...message.countUsage));

messenger.storage.onChanged.addListener((changes) => {
  if (changes.recipes) buildMenus();
  if ("budget" in changes || "usage" in changes) showBudgetBadge().catch(console.error);
  if (["recipes", "colorScheme", "triagedName", "triagedColor", "triagedColorLight", "unsureName"].some((k) => k in changes)) resyncTags();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", resyncTags);
buildMenus();
resyncTags();
showBudgetBadge().catch(console.error);
pruneScores().catch((e) => console.error("JevIt: pruning stored scores failed", e));
// The manager takes a draft as soon as it opens; one left from an earlier session never will be, and holds mail text.
messenger.storage.local.remove("draft").catch(console.error);

messenger.messages.onNewMailReceived.addListener(async (folder, list) => {
  if ((await loadSettings()).autoTriage) await triageList(list).catch((e) => (logError("Automatic triage", e), notify(`Jev triage failed: ${e.message}`, false)));
});

messenger.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") return messenger.runtime.openOptionsPage();
  // Only saved recipes need it: without any, the current defaults are used.
  const { recipes } = await messenger.storage.local.get("recipes");
  if (reason === "update" && recipes && updateRecipes(recipes)) await messenger.storage.local.set({ recipes });
});
messenger.browserAction.onClicked.addListener(() => {
  if (!running) return messenger.runtime.openOptionsPage();
  stopping.abort(new Error("Stopped", { cause: "stop" }));
  notify(`Stopped triage after ${done} mail(s). The rest has no Triaged tag, so you can pick it up later.`, true);
});
