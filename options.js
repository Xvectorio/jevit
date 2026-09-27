const $ = (s) => document.querySelector(s);
const FIELDS = ["name", "key", "color", "question", "yes", "no", "action", "folder"];
const options = (select, entries) => select.replaceChildren(...entries.map(([value, text]) => new Option(text, value)));
let s, folders;
const openExamples = new Set(); // recipe keys whose example list is expanded, kept across render()

// Pull form values back into `s` before any re-render or save.
function read() {
  s.apiKey = $("#apiKey").value.trim();
  s.consent = $("#consent").checked;
  s.model = $("#model").value.trim() || DEFAULTS.model;
  s.autoTriage = $("#autoTriage").checked;
  document.querySelectorAll("#recipes fieldset").forEach((fs, i) => {
    for (const f of FIELDS) s.recipes[i][f] = fs.elements[f].value.trim();
    s.recipes[i].threshold = Number(fs.elements.threshold.value);
  });
}

function render() {
  $("#apiKey").value = s.apiKey;
  $("#consent").checked = s.consent;
  showKeyHint();
  $("#model").value = s.model;
  $("#autoTriage").checked = s.autoTriage;
  $("#recipes").replaceChildren(
    ...s.recipes.map((r, i) => {
      const fs = $("#recipe").content.firstElementChild.cloneNode(true);
      options(fs.elements.action, Object.entries(ACTIONS));
      options(fs.elements.folder, [["", "Choose a folder…"], ...folders]);
      for (const f of FIELDS) fs.elements[f].value = r[f];
      fs.elements.threshold.value = r.threshold;
      const showFolder = () => (fs.querySelector(".folder").hidden = fs.elements.action.value !== "move");
      fs.elements.action.onchange = showFolder;
      showFolder();
      const ex = fs.querySelector(".examples");
      ex.open = openExamples.has(r.key);
      ex.ontoggle = () => (ex.open ? openExamples.add(r.key) : openExamples.delete(r.key));
      ex.querySelector("summary").textContent = `${r.examples.length} learned example(s)`;
      ex.querySelector("ul").replaceChildren(
        ...r.examples.map((e, j) => {
          const li = document.createElement("li");
          const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕", title: "Forget this example" });
          del.onclick = () => (read(), r.examples.splice(j, 1), render());
          li.append(`${e.label ? "✓ yes" : "✗ no"}: “${e.subject}” from ${e.from} `, del);
          return li;
        }),
      );
      fs.querySelector(".clear").onclick = () => (read(), (r.examples = []), render());
      fs.querySelector(".remove").onclick = () => (read(), s.recipes.splice(i, 1), render());
      return fs;
    }),
  );
  const taken = new Set(s.recipes.map((r) => r.key));
  options($("#library"), [
    ["", "Add recipe…"],
    ["blank", "Blank recipe"],
    ...RECIPE_LIBRARY.filter((r) => !taken.has(r.key)).map((r) => [r.key, r.name]),
  ]);
}

function showKeyHint() {
  $("#keyHint").textContent = $("#apiKey").value.trim() ? "" : "No API key yet: JevIt can't triage until you add one and click Save.";
}
$("#apiKey").oninput = showKeyHint;
// Consent takes effect immediately, without Save, so unticking stops requests right away.
$("#consent").onchange = (e) => messenger.storage.local.set({ consent: e.target.checked });

const blankRecipe = () =>
  ({ ...structuredClone(RECIPE_LIBRARY[0]), key: `jev_${Date.now()}`, name: "New recipe", color: "#808080", question: "Is `email` …?", yes: "", no: "" });

function addRecipe(r) {
  s.recipes.push(r);
  render();
  $("#recipes").lastElementChild.scrollIntoView();
}

$("#library").onchange = (e) => {
  read();
  const pick = RECIPE_LIBRARY.find((r) => r.key === e.target.value);
  addRecipe(pick ? structuredClone(pick) : blankRecipe());
};

// "New recipe from selected mail…" in the message list leaves the mails in `draft`.
async function takeDraft() {
  const { draft } = await messenger.storage.local.get("draft");
  if (!draft) return;
  await messenger.storage.local.remove("draft");
  read();
  const r = draftRecipe(draft, s.recipes.map((r) => r.key));
  openExamples.add(r.key);
  addRecipe(r);
  $("#status").textContent = `New recipe from ${draft.length} mail(s). Check the wording, then Save.`;
}

$("#export").onclick = () => {
  read();
  const backup = { app: "JevIt", exported: new Date().toISOString(), recipes: s.recipes };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  a.download = `jevit-recipes-${backup.exported.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

$("#import").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let imported;
  try {
    imported = parseBackup(await file.text());
  } catch (err) {
    $("#status").textContent = `Import failed: ${err.message}`;
    return;
  }
  read();
  let replaced = 0;
  for (const r of imported) {
    const i = s.recipes.findIndex((x) => x.key === r.key);
    if (i >= 0) (s.recipes[i] = r), replaced++;
    else s.recipes.push(r);
  }
  render();
  $("#status").textContent =
    `Imported ${imported.length} recipe(s): ${imported.length - replaced} new, ${replaced} replaced. Click Save to keep them.`;
};

$("#save").onclick = async () => {
  read();
  const keys = s.recipes.map((r) => r.key);
  const bad = s.recipes.find((r) =>
    !/^[a-z0-9_]+$/.test(r.key) || !r.question || !(r.threshold >= 0 && r.threshold <= 1) || (r.action === "move" && !r.folder));
  if (bad || new Set(keys).size !== keys.length) {
    $("#status").textContent =
      `Fix “${bad?.name ?? "duplicate tag key"}”: key a-z0-9_ and unique, question set, threshold 0–1, folder chosen for moves.`;
    return;
  }
  await messenger.storage.local.set(s);
  const existing = new Set((await messenger.messages.tags.list()).map((t) => t.key));
  for (const r of s.recipes.filter((r) => existing.has(r.key))) {
    await messenger.messages.tags.update(r.key, { tag: r.name, color: r.color.toUpperCase() });
  }
  $("#status").textContent = "Saved.";
};

(async () => {
  const accounts = Object.fromEntries((await messenger.accounts.list(false)).map((a) => [a.id, a.name]));
  folders = (await messenger.folders.query({ canAddMessages: true })).map((f) => [f.id, `${accounts[f.accountId]}${f.path}`]);
  s = await loadSettings();
  render();
  await takeDraft();
  messenger.storage.onChanged.addListener((changes) => {
    if (changes.draft?.newValue) takeDraft();
    // Examples taught from the popup or context menu while this page is open; keep them so Save doesn't drop them.
    if (changes.recipes?.newValue) {
      read();
      for (const r of s.recipes) {
        const stored = changes.recipes.newValue.find((x) => x.key === r.key);
        if (stored) r.examples = stored.examples;
      }
      render();
    }
  });
})();
