// Clicking a JevIt notification opens the manager, where the key and consent are set.
// Automatic triage runs on every new mail: show each kind of problem once per session, not each time.
// `reason` groups messages that differ only in details (counts, server replies).
const notified = new Set();
function notify(message, manual, reason = message) {
  if (!manual && notified.has(reason)) return;
  if (!manual) notified.add(reason);
  messenger.notifications.create("jevit", { type: "basic", title: "JevIt", message: message.slice(0, 250) });
}
messenger.notifications.onClicked.addListener((id) => id === "jevit" && messenger.runtime.openOptionsPage());

async function triageList(list, manual) {
  const s = await loadSettings();
  const missing = !s.apiKey ? "no TypeSafe API key is set"
    : !s.consent ? "sending mail to TypeSafe is not allowed yet"
    : budgetLeft(s, await loadUsage(), monthOf()) <= 0 ? `this month's budget of ${money(s.budget)} is used up`
    : "";
  if (missing) return notify(`Can't triage with Jev: ${missing}. Click here to open the JevIt manager.`, manual);
  await syncTags(s);
  let failed = 0, skipped = 0, excluded = 0, firstError, halted;
  running++;
  try {
    // ponytail: one message at a time; parallelize if big batches feel slow (limit: 1200 req/min)
    for await (const m of iterate(list)) {
      if (stop) break;
      if (s.excludedAccounts.includes(m.folder?.accountId)) {
        excluded++;
        continue;
      }
      // Only for mail you pick: new mail can't have been triaged yet, so a Triaged tag on it didn't come from JevIt.
      if (manual && s.skipTriaged && m.tags.includes(TRIAGED.key)) {
        skipped++;
        continue;
      }
      try {
        const { keys, answers } = await classify(m.id, s);
        await applyRecipes(m.id, s.recipes, keys, answers, true);
      } catch (e) {
        if (e.cause === "halt") {
          halted = e;
          break;
        }
        failed++;
        firstError ??= e;
        console.error("JevIt:", m.subject, e);
      }
      done++;
      showBudgetBadge().catch(console.error);
    }
  } finally {
    if (!--running) done = 0, stop = false;
    showBudgetBadge().catch(console.error);
  }
  if (manual && skipped) notify(`Skipped ${skipped} mail(s) that were already triaged. To judge them again, untick “Skip already triaged mail” in the JevIt manager.`, true);
  if (manual && excluded) notify(`Skipped ${excluded} mail(s) from accounts excluded in the JevIt manager.`, true);
  if (halted) notify(`Jev triage stopped: ${halted.message}`, manual, halted.message);
  if (failed) notify(`Jev triage failed for ${failed} mail(s): ${firstError.message}`, manual, firstError.message.split(":")[0]);
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
  if (what === "triage") triageList(list, true);
  if (what === "yes" || what === "no") teach(list, key, what === "yes").catch(console.error);
  if (what === "new") newRecipeFrom(list).catch(console.error);
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
  if (yes !== undefined) teach(await selectedMessages(tab), "jev_spam", yes).catch(console.error);
});

// While triage runs, the toolbar button counts the mails done so far (the total isn't known up front:
// big selections arrive in pages), and clicking it stops the run. Otherwise it shows "$" while this month's budget is used up.
let running = 0, done = 0, stop = false;
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
const resyncTags = async () => syncTags(await loadSettings()).catch((e) => console.error("JevIt: tag sync failed", e));
messenger.storage.onChanged.addListener((changes) => {
  if (changes.recipes) buildMenus();
  if ("budget" in changes || "usage" in changes) showBudgetBadge().catch(console.error);
  if (["recipes", "colorScheme", "triagedColor", "triagedColorLight"].some((k) => k in changes)) resyncTags();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", resyncTags);
buildMenus();
resyncTags();
showBudgetBadge().catch(console.error);

messenger.messages.onNewMailReceived.addListener(async (folder, list) => {
  if ((await loadSettings()).autoTriage) await triageList(list);
});

messenger.runtime.onInstalled.addListener(({ reason }) => reason === "install" && messenger.runtime.openOptionsPage());
messenger.browserAction.onClicked.addListener(() => {
  if (!running) return messenger.runtime.openOptionsPage();
  stop = true;
  notify(`Stopped triage after ${done} mail(s). The rest has no Triaged tag, so you can pick it up later.`, true);
});
