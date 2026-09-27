// Shared triage logic for background, popup and options pages (plain script, no bundler).
const JEV_API = "https://api.typesafe.ai/v1/systemone";
const BODY_CHARS = 6000; // ponytail: hard cut of the body; add smarter excerpting if long mails misclassify
const MAX_EXAMPLES = 20; // per recipe, newest kept; examples ride along in every request (~100 tokens each)

// A recipe is one yes/no question to Jev. A match always tags the mail; `action` adds one more step.
const ACTIONS = {
  tag: "Only tag",
  flag: "Tag + star",
  read: "Tag + mark read",
  junk: "Tag + mark as junk",
  move: "Tag + move to folder",
  junkmove: "Tag + mark as junk + move to folder",
};
const movesMail = (action) => action === "move" || action === "junkmove";
// recipe.folder is a folder id, or EVERY_ACCOUNT + name: "the folder with that name in the mail's own account".
const EVERY_ACCOUNT = "*:";
const TRIAGED = { key: "jev_triaged", name: "Triaged" }; // tag on every mail Jev has judged; colour is a setting

const recipe = (key, name, color, threshold, question, yes, no) =>
  ({ key, name, color, threshold, question, yes, no, action: "tag", folder: "", skipKnown: false, examples: [] });

// Ready-made recipes offered under "Add recipe". The first five are installed by default.
const RECIPE_LIBRARY = [
  { ...recipe("jev_spam", "Spam", "#CC0000", 0.8,
    "Is `email` unsolicited bulk mail, a scam, or a phishing attempt?",
    "Unrequested promotion from an unknown sender, fraud, fake invoices, requests for passwords or payment details.",
    "Mail the recipient signed up for or would expect, or genuine personal or business correspondence."), skipKnown: true },
  recipe("jev_reply", "Needs reply", "#FF9900", 0.6,
    "Does a person in `email` ask the recipient `me` to reply, decide, or do something?",
    "A direct question, request, invitation or deadline written by a person to `me`.",
    "Automated notifications, newsletters, receipts, FYI mail, or mail that needs nothing from `me`."),
  recipe("jev_newsletter", "Newsletter", "#3366CC", 0.7,
    "Is `email` a newsletter, marketing campaign, or other bulk mailing?",
    "Sent to a list: newsletters, promotions, product updates, digests.",
    "Written to the recipient individually, or a transactional message about their own account or order."),
  recipe("jev_finance", "Invoice / receipt", "#009933", 0.7,
    "Is `email` an invoice, receipt, payment request, or payment confirmation?",
    "Bills, invoices, receipts, order confirmations with amounts, payment reminders.",
    "Anything that is not about a specific payment."),
  recipe("jev_urgent", "Urgent", "#990099", 0.7,
    "Does `email` say that something is urgent, time-critical, or due very soon?",
    "Explicit urgency: ASAP, today, outage, final notice, a deadline that is close.",
    "No time pressure expressed."),
  recipe("jev_calendar", "Meeting / event", "#0099CC", 0.7,
    "Is `email` an invitation to, or a change to, a meeting, call, or event?",
    "Calendar invites, reschedules, cancellations, event registrations with a date.",
    "Mail that only mentions an event in passing, or event marketing sent to a list."),
  recipe("jev_shipping", "Shipping", "#996633", 0.7,
    "Is `email` a shipping, delivery, or tracking update for an order?",
    "Dispatch notices, tracking numbers, delivery attempts, pickup notices.",
    "Order confirmations without shipping news, or marketing from a shop."),
  recipe("jev_security", "Security alert", "#CC3366", 0.7,
    "Is `email` a login alert, verification code, password reset, or other account security notice?",
    "New sign-in alerts, one-time codes, password or 2FA changes, account lock notices.",
    "Marketing or newsletters that only mention security."),
  recipe("jev_personal", "Personal", "#669900", 0.7,
    "Was `email` written personally by a human to `me`, rather than sent by an automated system or to a list?",
    "A human wrote this message to the recipient, such as a friend, colleague, or customer.",
    "Automated, templated, or bulk mail."),
  recipe("jev_social", "Social", "#6666CC", 0.7,
    "Is `email` a notification from a social network, forum, or community site?",
    "Likes, mentions, follows, comments, friend requests, digests from social sites.",
    "Direct mail from a person, or anything not from a social or community platform."),
  recipe("jev_jobs", "Jobs / recruiting", "#336666", 0.7,
    "Is `email` about a job opportunity, a job application, or recruiting?",
    "Recruiter outreach, application confirmations, interview invitations, job alerts.",
    "Anything not about hiring or applying for work."),
];

const DEFAULTS = {
  apiKey: "",
  consent: false, // explicit opt-in before any mail content leaves Thunderbird (ATN policy)
  model: "jev-latest",
  autoTriage: false,
  triagedColor: "#2A9D8F",
  budget: 1, // USD per calendar month; 0 = no limit
  pricePerMtok: 0.042, // USD per million input tokens (jev-1.13; output tokens are free)
  recipes: RECIPE_LIBRARY.slice(0, 5),
};

function cleanBody(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => !l.startsWith(">")) // quoted replies are noise for the current mail
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BODY_CHARS);
}

function questionFor(r) {
  const ex = (label) => r.examples.filter((e) => e.label === label).map(({ label, ...e }) => e);
  const instructions = r.examples.length
    ? {
        question: `${r.question} The recipient's own verdicts on earlier emails are in \`examples_yes\` (answer was yes) and \`examples_no\` (answer was no).`,
        examples_yes: ex(true),
        examples_no: ex(false),
      }
    : r.question;
  return { type: "noul", instructions, criteria: { true: r.yes, false: r.no } };
}

function questionsFor(recipes) {
  return Object.fromEntries(recipes.map((r) => [r.key, questionFor(r)]));
}

// Recipe keys whose yes-probability clears that recipe's threshold. A recipe set to skip known senders
// never matches mail from someone you know, whatever Jev says.
function decide(recipes, answers, known = false) {
  return recipes.filter((r) => answers[r.key]?.noul >= r.threshold && !(known && r.skipKnown)).map((r) => r.key);
}

// "Name <x@y.z>" -> "x@y.z"
const senderEmail = (author = "") => (author.match(/<([^>]+)>/)?.[1] ?? author).trim().toLowerCase();

// Every email address in a contact's fields (plain fields and vCard text alike), lowercased.
const emailsIn = (contact) =>
  Object.values(contact.properties ?? {}).flatMap((v) => (typeof v === "string" ? v.toLowerCase().match(/[^\s:;,<>"]+@[^\s:;,<>"]+/g) ?? [] : []));

// What the matched recipes do besides tagging. A mail can only move once: the most probable move wins.
function plan(recipes, keys, answers) {
  const hit = recipes.filter((r) => keys.includes(r.key));
  const has = (...actions) => hit.some((r) => actions.includes(r.action));
  const move = hit
    .filter((r) => movesMail(r.action) && r.folder)
    .sort((a, b) => (answers[b.key]?.noul ?? 0) - (answers[a.key]?.noul ?? 0))[0];
  return {
    update: { ...(has("read") && { read: true }), ...(has("flag") && { flagged: true }), ...(has("junk", "junkmove") && { junk: true }) },
    folder: move?.folder ?? null,
  };
}

function addExample(recipe, email, label) {
  const example = { from: email.from, subject: email.subject, snippet: email.body.slice(0, 300), label };
  recipe.examples = [...recipe.examples, example].slice(-MAX_EXAMPLES);
}

// "Free Mobile <x@free.fr>" -> "Free Mobile"; "x@free.fr" -> "free.fr".
function senderName(from = "") {
  const display = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  if (display && !display.includes("@")) return display;
  return from.match(/@([^>\s]+)/)?.[1] ?? "New recipe";
}

// A "more like this" recipe from mails the user picked: Jev compares new mail with them.
function draftRecipe(emails, takenKeys) {
  const name = senderName(emails[0].from);
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "recipe";
  let key = `jev_${slug}`;
  for (let n = 2; takenKeys.includes(key); n++) key = `jev_${slug}_${n}`;
  const r = recipe(key, name, "#808080", 0.7,
    "Is `email` the same kind of mail as the ones in `examples_yes`?",
    `Same kind of sender, purpose and content as the mails in \`examples_yes\`, e.g. “${emails[0].subject}” from ${name}.`,
    "A different kind of mail, even if it comes from the same sender.");
  for (const email of emails) addExample(r, email, true);
  return r;
}

// Recipes from an exported backup file. The file is untrusted input: keep only known fields with sane values.
function parseBackup(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.recipes;
  if (!Array.isArray(list)) throw new Error("No recipes in this file");
  const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);
  return list.map((r) => {
    if (!/^[a-z0-9_]+$/.test(str(r?.key)) || !str(r.question)) throw new Error(`Invalid recipe: ${str(r?.name, str(r?.key, "?"))}`);
    return {
      key: r.key,
      name: str(r.name, r.key),
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#808080",
      threshold: typeof r.threshold === "number" && r.threshold >= 0 && r.threshold <= 1 ? r.threshold : 0.7,
      question: r.question,
      yes: str(r.yes),
      no: str(r.no),
      action: Object.hasOwn(ACTIONS, r.action) ? r.action : "tag",
      folder: str(r.folder),
      skipKnown: r.skipKnown === true,
      examples: (Array.isArray(r.examples) ? r.examples : [])
        .filter((e) => typeof e?.label === "boolean")
        .map((e) => ({ from: str(e.from), subject: str(e.subject), snippet: str(e.snippet).slice(0, 300), label: e.label }))
        .slice(-MAX_EXAMPLES),
    };
  });
}

async function askJev({ apiKey, model }, state, questions) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(JEV_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
    });
    if ((r.status === 429 || r.status === 529) && attempt < 4) {
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`Jev ${r.status}: ${await r.text()}`);
    return r.json(); // { model, answers, usage: { input_tokens, output_tokens } }
  }
}

// --- Usage and budget (estimated from the token counts Jev returns) ---

const monthOf = (date = new Date()) => date.toISOString().slice(0, 7); // "2026-09"
const money = (usd) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(5) : usd.toFixed(2)}`;
const emptyUsage = () => ({ requests: 0, inputTokens: 0, cost: 0 });

// Counters after one more request: this month's (restarting when the month changes) and all-time.
function addUsage(usage, month, inputTokens, pricePerMtok) {
  const cost = (inputTokens * pricePerMtok) / 1e6;
  const add = (u) => ({ requests: u.requests + 1, inputTokens: u.inputTokens + inputTokens, cost: u.cost + cost });
  const current = usage?.month === month ? usage : emptyUsage();
  return { month, ...add(current), total: add(usage?.total ?? emptyUsage()) };
}

// Dollars left in this month's budget; Infinity without a budget.
function budgetLeft(settings, usage, month) {
  if (!(settings.budget > 0)) return Infinity;
  return settings.budget - (usage?.month === month ? usage.cost : 0);
}

// --- Thunderbird side ---

const loadUsage = async () => (await messenger.storage.local.get({ usage: null })).usage;

const loadSettings = () => messenger.storage.local.get(DEFAULTS);

async function emailState(id) {
  const m = await messenger.messages.get(id);
  const parts = await messenger.messages.listInlineTextParts(id);
  const plain = parts.find((p) => p.contentType === "text/plain");
  const html = parts.find((p) => p.contentType === "text/html");
  const body = plain
    ? plain.content
    : html
      ? new DOMParser().parseFromString(html.content, "text/html").body.textContent
      : "";
  const identity = m.folder ? await messenger.identities.getDefault(m.folder.accountId) : null;
  return {
    me: identity?.email ?? "",
    email: { from: m.author, to: m.recipients, cc: m.ccList, subject: m.subject, body: cleanBody(body) },
  };
}

async function classify(id, settings) {
  if (!settings.consent) throw new Error("Allow sending mail to TypeSafe first (JevIt manager, top of the page).");
  const month = monthOf();
  if (budgetLeft(settings, await loadUsage(), month) <= 0) {
    throw new Error(`Monthly Jev budget of ${money(settings.budget)} reached. Raise it in the JevIt manager, or wait for next month.`);
  }
  const state = await emailState(id);
  const [response, known] = await Promise.all([
    askJev(settings, state, questionsFor(settings.recipes)),
    // A failing lookup must not fail the triage: the Jev request is already paid for. Treat as unknown.
    settings.recipes.some((r) => r.skipKnown)
      ? knownSender(state.email.from).catch((e) => (console.warn("JevIt: known-sender check failed", e), false))
      : false,
  ]);
  // ponytail: read-modify-write; a popup and a background batch finishing at the same moment can drop one count
  const usage = addUsage(await loadUsage(), month, response.usage?.input_tokens ?? 0, settings.pricePerMtok);
  await messenger.storage.local.set({ usage });
  return { state, answers: response.answers, known, keys: decide(settings.recipes, response.answers, known) };
}

// Is the sender someone you know: in a local address book (including Collected Addresses), or a recipient
// of mail in your Sent folders? Checked locally; nothing is sent anywhere. Your own addresses don't count,
// because spam often fakes them.
// ponytail: two local lookups per mail, no cache; add a per-batch cache if big batches get slow.
async function knownSender(author) {
  const email = senderEmail(author);
  if (!email.includes("@")) return false;
  const own = (await messenger.identities.list()).map((i) => i.email.toLowerCase());
  if (own.includes(email)) return false;
  const contacts = await messenger.contacts.quickSearch({ searchString: email, includeRemote: false }); // MV2 API
  if (contacts.some((c) => emailsIn(c).includes(email))) return true;
  const sent = (await messenger.folders.query({ specialUse: ["sent"] })).map((f) => f.id);
  if (!sent.length) return false;
  const found = await messenger.messages.query({ folderId: sent, recipients: email, messagesPerPage: 1 });
  return (found.messages ?? found).length > 0;
}

// Set this extension's tags (leaving the user's other tags alone), then run the matched recipes' actions.
// `triagedColor`: set when Jev judged this mail, which then also gets the Triaged tag in that colour
// (kept on later re-triage or teaching).
async function applyRecipes(id, recipes, keys, answers, triagedColor = null) {
  const extra = triagedColor ? [{ ...TRIAGED, color: triagedColor }] : [];
  const existing = new Set((await messenger.messages.tags.list()).map((t) => t.key));
  for (const r of [...recipes, ...extra]) {
    if (!existing.has(r.key)) await messenger.messages.tags.create(r.key, r.name, r.color.toUpperCase());
  }
  const ours = new Set(recipes.map((r) => r.key));
  const m = await messenger.messages.get(id);
  const { update, folder } = plan(recipes, keys, answers);
  const tags = new Set([...m.tags.filter((t) => !ours.has(t)), ...keys, ...extra.map((t) => t.key)]);
  await messenger.messages.update(id, { ...update, tags: [...tags] });
  const target = folder && m.folder ? await resolveFolder(folder, m.folder.accountId) : folder;
  if (target && target !== m.folder?.id) await messenger.messages.move([id], target);
}

// Folder id for a recipe's folder. An every-account folder is looked up by name in the given account
// (top-most match wins) and created at the account's top level if that account doesn't have it yet.
async function resolveFolder(folder, accountId) {
  if (!folder.startsWith(EVERY_ACCOUNT)) return folder;
  const name = folder.slice(EVERY_ACCOUNT.length);
  const found = (await messenger.folders.query({ accountId, name }))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  if (found) return found.id;
  const [root] = await messenger.folders.query({ accountId, isRoot: true });
  return (await messenger.folders.create(root.id, name)).id;
}

async function* iterate(list) {
  for (;;) {
    yield* list.messages;
    if (!list.id) return;
    list = await messenger.messages.continueList(list.id);
  }
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULTS, RECIPE_LIBRARY, cleanBody, questionFor, questionsFor, decide, plan, addExample, draftRecipe, parseBackup, askJev, resolveFolder, applyRecipes, knownSender, addUsage, budgetLeft, money };
}
