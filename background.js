// Clicking a JevIt notification opens the manager, where the key and consent are set.
let autoNotified = false; // automatic triage runs on every new mail: tell the user once per session, not each time
function notify(message, manual) {
  if (!manual && autoNotified) return;
  autoNotified ||= !manual;
  messenger.notifications.create("jevit", { type: "basic", title: "JevIt", message: message.slice(0, 250) });
}
messenger.notifications.onClicked.addListener((id) => id === "jevit" && messenger.runtime.openOptionsPage());

async function triageList(list, manual) {
  const s = await loadSettings();
  const missing = !s.apiKey ? "no TypeSafe API key is set" : !s.consent ? "sending mail to TypeSafe is not allowed yet" : "";
  if (missing) return notify(`Can't triage with Jev: ${missing}. Click here to open the JevIt manager.`, manual);
  let failed = 0, firstError;
  // ponytail: one message at a time; parallelize if big batches feel slow (limit: 1200 req/min)
  for await (const m of iterate(list)) {
    try {
      const { keys, answers } = await classify(m.id, s);
      await applyRecipes(m.id, s.recipes, keys, answers, s.triagedColor);
    } catch (e) {
      failed++;
      firstError ??= e;
      console.error("JevIt:", m.subject, e);
    }
  }
  if (failed) notify(`Jev triage failed for ${failed} mail(s): ${firstError.message}`, manual);
}

// Selected mails become a yes/no example for one recipe, and its tag (plus action on yes) is applied.
async function teach(list, key, yes) {
  const s = await loadSettings();
  const r = s.recipes.find((r) => r.key === key);
  if (!r) return console.warn(`JevIt: no recipe with tag key ${key}`);
  for await (const m of iterate(list)) {
    addExample(r, (await emailState(m.id)).email, yes);
    await applyRecipes(m.id, [r], yes ? [key] : [], {});
  }
  await messenger.storage.local.set({ recipes: s.recipes });
}

// Hand the selected mails to the manager page, which opens a new unsaved recipe with them as yes examples.
async function newRecipeFrom(list) {
  const draft = [];
  for await (const m of iterate(list)) draft.push((await emailState(m.id)).email);
  await messenger.storage.local.set({ draft });
  messenger.runtime.openOptionsPage();
}

async function buildMenus() {
  const { recipes } = await loadSettings();
  await messenger.menus.removeAll();
  const add = (props) => messenger.menus.create({ contexts: ["message_list"], ...props });
  add({ id: "root", title: "JevIt", icons: { 16: "icon.svg" } });
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
}

messenger.menus.onClicked.addListener((info) => {
  const [what, key] = String(info.menuItemId).split(":");
  const list = info.selectedMessages;
  if (what === "triage") triageList(list, true);
  if (what === "yes" || what === "no") teach(list, key, what === "yes").catch(console.error);
  if (what === "new") newRecipeFrom(list).catch(console.error);
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

messenger.storage.onChanged.addListener((changes) => changes.recipes && buildMenus());
buildMenus();

messenger.messages.onNewMailReceived.addListener(async (folder, list) => {
  if ((await loadSettings()).autoTriage) await triageList(list);
});

messenger.runtime.onInstalled.addListener(({ reason }) => reason === "install" && messenger.runtime.openOptionsPage());
messenger.browserAction.onClicked.addListener(() => messenger.runtime.openOptionsPage());
