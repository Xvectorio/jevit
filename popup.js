const $ = (s) => document.querySelector(s);
const status = (text) => ($("#status").textContent = text);
let settings, result, msgId;

$("#options").onclick = () => messenger.runtime.openOptionsPage();
$("#help").onclick = () => messenger.tabs.create({ url: "help.html" });

(async () => {
  settings = await loadSettings();
  if (!settings.apiKey || !settings.consent) return status("Set your TypeSafe API key and allow sending mail under “Manage recipes…”.");
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  const shown = await messenger.messageDisplay.getDisplayedMessages(tab.id);
  const msg = (shown.messages ?? shown)[0];
  if (!msg) return status("No message displayed.");
  if (settings.excludedAccounts.includes(msg.folder?.accountId)) return status("This account is excluded from JevIt under “Manage recipes…”.");
  msgId = msg.id;
  status("Asking Jev…");
  try {
    result = await classify(msgId, settings);
  } catch (e) {
    return status(e.message);
  }
  for (const [i, r] of settings.recipes.entries()) {
    const p = result.answers[r.key]?.noul ?? 0;
    const tr = $("#rows").insertRow();
    tr.innerHTML = `<td><label><input type="checkbox"> <span></span></label></td>
      <td><meter min="0" max="1" optimum="0"></meter></td>
      <td class="hint"></td>`;
    Object.assign(tr.querySelector("input"), { id: `c${i}`, checked: result.keys.includes(r.key) });
    tr.querySelector("span").textContent = r.name;
    Object.assign(tr.querySelector("meter"), { low: r.threshold, value: p });
    tr.querySelector(".hint").textContent = result.known && r.skipKnown
      ? `${Math.round(p * 100)}%, but you know this sender: not tagged`
      : `${Math.round(p * 100)}% (tag at ${Math.round(r.threshold * 100)}%)`;
  }
  status(`Jev's suggestion for “${msg.subject}”. Adjust and apply:`);
  $("#apply").disabled = false;
})();

$("#apply").onclick = async () => {
  const checked = settings.recipes.filter((r, i) => $(`#c${i}`).checked).map((r) => r.key);
  if ($("#teach").checked) {
    const wrong = settings.recipes.filter((r) => checked.includes(r.key) !== result.keys.includes(r.key));
    for (const r of wrong) addExample(r, result.state.email, checked.includes(r.key));
    if (wrong.length) await messenger.storage.local.set({ recipes: settings.recipes });
  }
  await syncTags(settings);
  await applyRecipes(msgId, settings.recipes, checked, result.answers, true);
  window.close();
};
