const $ = (s) => document.querySelector(s);
const SPAM_KEY = "jev_spam"; // the Connection switch "Never tag … as Spam" mirrors this recipe's skipKnown
const FIELDS = ["name", "key", "color", "colorLight", "question", "yes", "no", "action", "folder"];
const options = (select, entries) => select.replaceChildren(...entries.map(([value, text]) => new Option(text, value)));
let s, folders, parents, defaultAccount, sharedNames, accounts;
// Recipe keys whose card / example list is expanded, kept across render().
const openRecipes = new Set();
const openExamples = new Set();
const keepOpen = (el, set, key) => {
  el.open = set.has(key);
  el.ontoggle = () => (el.open ? set.add(key) : set.delete(key));
};

// Pull form values back into `s` before any re-render or save.
function read() {
  s.apiKey = $("#apiKey").value.trim();
  s.consent = $("#consent").checked;
  s.model = $("#model").value.trim() || DEFAULTS.model;
  s.autoTriage = $("#autoTriage").checked;
  s.skipTriaged = $("#skipTriaged").checked;
  s.excludedAccounts = [...document.querySelectorAll("#excludedAccounts input:checked")].map((c) => c.value);
  s.triagedColor = $("#triagedColor").value;
  s.triagedColorLight = $("#triagedColorLight").value;
  s.colorScheme = $("#colorScheme").value;
  s.budget = Number($("#budget").value);
  s.pricePerMtok = Number($("#pricePerMtok").value);
  s.bodyChars = Number($("#bodyChars").value);
  s.actSure = Number($("#actSure").value);
  s.unsureMargin = Number($("#unsureMargin").value);
  document.querySelectorAll("#recipes fieldset").forEach((fs, i) => {
    for (const f of FIELDS) s.recipes[i][f] = fs.elements[f].value.trim();
    s.recipes[i].threshold = Number(fs.elements.threshold.value);
    s.recipes[i].skipKnown = fs.elements.skipKnown.checked;
  });
}

function render() {
  $("#apiKey").value = s.apiKey;
  $("#consent").checked = s.consent;
  showKeyHint();
  $("#model").value = s.model;
  $("#autoTriage").checked = s.autoTriage;
  $("#skipTriaged").checked = s.skipTriaged;
  $("#excludedAccounts").replaceChildren(...Object.entries(accounts).map(([id, name]) => {
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox"> <span>Never send mail in account <b></b> to Jev</span>`;
    label.querySelector("b").textContent = name;
    Object.assign(label.querySelector("input"), { value: id, checked: s.excludedAccounts.includes(id) });
    return label;
  }));
  $("#triagedColor").value = s.triagedColor;
  $("#triagedColorLight").value = s.triagedColorLight;
  $("#colorScheme").value = s.colorScheme;
  const spam = s.recipes.find((r) => r.key === SPAM_KEY);
  $("#spamKnownRow").hidden = !spam;
  $("#spamKnown").checked = !!spam?.skipKnown;
  showAuthServers();
  $("#budget").value = s.budget;
  $("#pricePerMtok").value = s.pricePerMtok;
  $("#bodyChars").value = s.bodyChars;
  $("#actSure").value = s.actSure;
  $("#unsureMargin").value = s.unsureMargin;
  showUsage();
  $("#recipes").replaceChildren(
    ...s.recipes.map((r, i) => {
      const card = $("#recipe").content.firstElementChild.cloneNode(true);
      const fs = card.querySelector("fieldset");
      options(fs.elements.action, Object.entries(ACTIONS));
      const everyNames = new Set(sharedNames);
      if (r.folder.startsWith(EVERY_ACCOUNT)) everyNames.add(r.folder.slice(EVERY_ACCOUNT.length));
      options(fs.elements.folder, [
        ["", "Choose a folder…"],
        ...[...everyNames].map((n) => [EVERY_ACCOUNT + n, `Every account: ${n}`]),
        ...folders.map((f) => [f.id, f.label]),
        ["new", "New folder…"],
      ]);
      for (const f of FIELDS) fs.elements[f].value = r[f];
      fs.elements.colorLight.value = colorFor(r, "light"); // recipes saved before light colours existed
      fs.elements.threshold.value = r.threshold;
      fs.elements.skipKnown.checked = !!r.skipKnown;
      keepOpen(card, openRecipes, r.key);
      // "New folder…": create it under the chosen parent (or at the top of every account), then select it.
      const nf = card.querySelector(".newfolder");
      const account = folders.find((f) => f.id === r.folder)?.accountId ?? defaultAccount;
      options(nf.querySelector(".parent"), parents.map((f) => [f.id, f.label]));
      nf.querySelector(".parent").value = parents.find((f) => f.accountId === account && f.path === "/")?.id ?? parents[0]?.id ?? "";
      const create = async () => {
        const name = nf.querySelector(".newname").value.trim();
        if (!name) return nf.querySelector(".newname").focus();
        try {
          let done;
          if (nf.querySelector(".every").checked) {
            const roots = parents.filter((f) => f.path === "/");
            const results = await Promise.allSettled(roots.map((root) => messenger.folders.create(root.id, name)));
            const made = results.filter((x) => x.status === "fulfilled").length;
            read();
            r.folder = EVERY_ACCOUNT + name;
            done = `Folder “${name}” created in ${made} of ${roots.length} account(s)` +
              (made < roots.length ? " (the others may already have it)" : "");
          } else {
            const f = await messenger.folders.create(nf.querySelector(".parent").value, name);
            read();
            r.folder = f.id;
            done = `Folder “${name}” created`;
          }
          await loadFolders();
          render();
          $("#status").textContent = `${done}. Click Save to keep it for this recipe.`;
        } catch (e) {
          $("#status").textContent = `Could not create folder: ${e.message}`;
        }
      };
      nf.querySelector(".create").onclick = create;
      // Block body on purpose: an on… handler that returns false cancels the key press.
      nf.querySelector(".newname").onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          create();
        }
      };
      nf.querySelector(".every").onchange = (e) => (nf.querySelector(".parent").disabled = e.target.checked);
      nf.querySelector(".cancel").onclick = () => ((fs.elements.folder.value = ""), (nf.hidden = true));
      // One-line summary of the card, kept current while editing.
      const summarize = () => {
        const el = fs.elements;
        // Half dark-theme colour, half light-theme colour.
        card.querySelector(".dot").style.background = `linear-gradient(90deg, ${el.color.value} 50%, ${el.colorLight.value} 50%)`;
        card.querySelector(".title").textContent = el.name.value || "(unnamed)";
        card.querySelector(".meta").textContent =
          `${ACTIONS[el.action.value]} · at ${Math.round(Number(el.threshold.value) * 100)}%` +
          `${el.skipKnown.checked ? " · not for known senders" : ""} · ${r.examples.length} example(s)`;
        card.querySelector(".folder").hidden = !movesMail(el.action.value);
        if (r.key === SPAM_KEY) $("#spamKnown").checked = el.skipKnown.checked;
        nf.hidden = !movesMail(el.action.value) || el.folder.value !== "new";
      };
      fs.oninput = summarize;
      summarize();
      const ex = fs.querySelector(".examples");
      keepOpen(ex, openExamples, r.key);
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
      return card;
    }),
  );
  const taken = new Set(s.recipes.map((r) => r.key));
  options($("#library"), [
    ["", "Add recipe…"],
    ["blank", "Blank recipe"],
    ...RECIPE_LIBRARY.filter((r) => !taken.has(r.key)).map((r) => [r.key, r.name]),
  ]);
}

// The key can only be entered after consent. Both save immediately, without Save:
// unticking stops requests right away, and a typed key can't be lost to a failed Save.
function showKeyHint() {
  const consent = $("#consent").checked;
  $("#apiKey").disabled = !consent;
  $("#keyHint").textContent = !consent
    ? "Tick the box above first to enter your API key."
    : $("#apiKey").value.trim() ? "" : "No API key yet: JevIt can't triage until you add one.";
}
$("#apiKey").oninput = showKeyHint;
$("#apiKey").onchange = async (e) => {
  await messenger.storage.local.set({ apiKey: e.target.value.trim() });
  $("#status").textContent = "API key saved.";
};
$("#consent").onchange = async (e) => {
  showKeyHint();
  await messenger.storage.local.set({ consent: e.target.checked });
  if (e.target.checked && !$("#apiKey").value.trim()) $("#apiKey").focus();
};

// Each account's mail server whose DMARC verdict JevIt trusts; detected when a known sender is first checked.
async function showAuthServers() {
  const { authServers = {} } = await messenger.storage.local.get("authServers");
  const name = (id) => (id === null ? "none found, so no sender counts as known" : id || "Microsoft (unnamed)");
  const found = Object.entries(accounts).filter(([id]) => id in authServers).map(([id, account]) => `${account}: ${name(authServers[id].id)}`);
  $("#authServers").textContent = `Trusted mail server: ${found.length ? found.join(" · ") : "detected on the first triage"}`;
  $("#authServers").hidden = $("#spamKnownRow").hidden;
}

// This month's and all-time usage, against the budget currently in the form.
async function showUsage() {
  const usage = await loadUsage();
  const month = monthOf();
  const current = usage?.month === month ? usage : emptyUsage();
  const budget = Number($("#budget").value);
  const line = (u) => `${u.requests.toLocaleString()} request(s) · ${u.inputTokens.toLocaleString()} tokens · ${money(u.cost)}`;
  $("#usageMonthName").textContent = new Date().toLocaleString(undefined, { month: "long", year: "numeric" });
  $("#usageMonth").textContent = line(current) + (budget > 0 ? ` of ${money(budget)}` : " (no budget limit)");
  $("#usageTotal").textContent = line(usage?.total ?? emptyUsage());
  $("#budgetMeter").hidden = !(budget > 0);
  $("#budgetMeter").value = budget > 0 ? Math.min(current.cost / budget, 1) : 0;
}
$("#budget").oninput = showUsage;
$("#defaultColors").onclick = () => {
  read();
  for (const r of s.recipes) if (PALETTE[r.key]) [r.color, r.colorLight] = PALETTE[r.key];
  s.triagedColor = DEFAULTS.triagedColor;
  s.triagedColorLight = DEFAULTS.triagedColorLight;
  render();
  $("#status").textContent = "Default colours set for built-in recipes and Triaged. Click Save to apply them to your mail.";
};
$("#spamKnown").onchange = (e) => {
  read();
  const spam = s.recipes.find((r) => r.key === SPAM_KEY);
  if (spam) spam.skipKnown = e.target.checked;
  render();
  $("#status").textContent = "Click Save to keep it.";
};
$("#resetUsage").onclick = async () => {
  await messenger.storage.local.remove("usage");
  $("#status").textContent = "Usage counters reset.";
};

const blankRecipe = () =>
  ({ ...structuredClone(RECIPE_LIBRARY[0]), key: `jev_${Date.now()}`, name: "New recipe", color: NEW_RECIPE_COLORS[0], colorLight: NEW_RECIPE_COLORS[1], question: "Is `email` …?", yes: "", no: "" });

function addRecipe(r) {
  s.recipes.push(r);
  openRecipes.add(r.key);
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

const validFolder = (folder) =>
  folders.some((f) => f.id === folder) || (folder.startsWith(EVERY_ACCOUNT) && folder.length > EVERY_ACCOUNT.length);

async function save() {
  read();
  if (!(s.budget >= 0) || !(s.pricePerMtok >= 0)) {
    $("#status").textContent = "Fix the budget and price: they must be numbers, 0 or more.";
    return;
  }
  if (!(Number.isInteger(s.bodyChars) && s.bodyChars >= 0)) {
    $("#status").textContent = "Fix the text limit: a whole number of characters, 0 or more.";
    return;
  }
  if (!(s.actSure >= 0 && s.actSure <= 1) || !(s.unsureMargin >= 0 && s.unsureMargin <= 1)) {
    $("#status").textContent = "Fix “Act only when Jev is this sure” and the unsure margin: numbers from 0 to 1.";
    return;
  }
  const keys = s.recipes.map((r) => r.key);
  const bad = s.recipes.find((r) =>
    !/^[a-z0-9_]+$/.test(r.key) || !r.question || !(r.threshold >= 0 && r.threshold <= 1) || (movesMail(r.action) && !validFolder(r.folder)));
  if (bad || new Set(keys).size !== keys.length) {
    if (bad) openRecipes.add(bad.key), render();
    $("#status").textContent =
      `Fix “${bad?.name ?? "duplicate tag key"}”: key a-z0-9_ and unique, question set, threshold 0–1, folder chosen for moves.`;
    return;
  }
  await messenger.storage.local.set(s);
  await syncTags(s);
  $("#status").textContent = "Saved.";
}
document.querySelectorAll(".save").forEach((b) => (b.onclick = save));
$("#help").onclick = (e) => {
  e.preventDefault();
  messenger.tabs.create({ url: "help.html" });
};
$("#kofi").onclick = (e) => {
  e.preventDefault();
  messenger.windows.openDefaultBrowser(e.currentTarget.href);
};

// Move targets, and where new folders can go (account top levels first). Labels read "Account/path".
async function loadFolders() {
  accounts = Object.fromEntries((await messenger.accounts.list(false)).map((a) => [a.id, a.name]));
  const labelled = (list) => list
    .map((f) => ({ id: f.id, accountId: f.accountId, path: f.path, name: f.name, label: f.path === "/" ? `${accounts[f.accountId]} (top level)` : `${accounts[f.accountId]}${f.path}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  folders = labelled(await messenger.folders.query({ canAddMessages: true }));
  parents = labelled(await messenger.folders.query({ canAddSubfolders: true }));
  defaultAccount = (await messenger.accounts.getDefault())?.id;
  // Folder names present in more than one account, offered as "Every account: <name>".
  const accountsOf = new Map();
  for (const f of folders) accountsOf.set(f.name, new Set([...(accountsOf.get(f.name) ?? []), f.accountId]));
  sharedNames = [...accountsOf].filter(([, a]) => a.size > 1).map(([n]) => n).sort();
}

(async () => {
  await loadFolders();
  s = await loadSettings();
  render();
  await takeDraft();
  messenger.storage.onChanged.addListener((changes) => {
    if (changes.draft?.newValue) takeDraft();
    if (changes.usage) showUsage();
    if (changes.authServers) showAuthServers();
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
$("#version").textContent = `JevIt ${messenger.runtime.getManifest().version}`;
