// Shared triage logic for background, popup and options pages (plain script, no bundler).
const JEV_API = "https://api.typesafe.ai/v1/systemone";
const HEADER_CHARS = 1000; // per header (and per address, subject, sender), so a sender can't inflate the request
const MAX_RECIPIENTS = 20; // To and Cc each; enough to tell a personal mail from a mass mailing
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

// Tag colours as [dark theme, light theme]. Thunderbird colours the message row text with the tag colour,
// so each recipe has two. Dark set: one hue each at the same pale lightness (HSL h/100%/92%), a hint of
// colour on a dark background (12-16:1 contrast). Light set: the same hues, darkened to >= 5.2:1 on white.
const PALETTE = {
  jev_spam: ["#FFD6D6", "#D31717"],
  jev_reply: ["#FFEBD6", "#A15912"],
  jev_shipping: ["#FFF5D6", "#85680F"],
  jev_personal: ["#EEFFD6", "#4B770D"],
  jev_finance: ["#D6FFE4", "#0E7C32"],
  jev_jobs: ["#D6FFF8", "#0D7766"],
  jev_calendar: ["#D6F8FF", "#0F758A"],
  jev_newsletter: ["#D6E4FF", "#1E61E6"],
  jev_social: ["#DDD6FF", "#6347EB"],
  jev_urgent: ["#F8D6FF", "#B417D3"],
  jev_security: ["#FFD6EB", "#CF1773"],
};
const NEW_RECIPE_COLORS = ["#E6E6E6", "#595959"]; // greys for recipes you add yourself
const defaultColors = (key) => PALETTE[key] ?? NEW_RECIPE_COLORS;

const recipe = (key, name, threshold, question, yes, no) => {
  const [color, colorLight] = defaultColors(key);
  return { key, name, color, colorLight, threshold, question, yes, no, action: "tag", folder: "", skipKnown: false, examples: [] };
};

// Ready-made recipes offered under "Add recipe". The first five are installed by default.
const RECIPE_LIBRARY = [
  { ...recipe("jev_spam", "Spam", 0.8,
    "Is `email` unsolicited bulk mail, a scam, or a phishing attempt?",
    "Phishing: `me`'s mailbox, password, storage, wallet or bank account supposedly needs action, from an address that doesn't belong to that company. " +
      "Fake business mail: purchase orders, quotes, invoices or payment proofs `me` never asked for, often a \"RE:\" without an earlier conversation. " +
      "Scams: prizes, gift cards, inheritances, dating approaches, miracle health or bargain products. " +
      "Cold sales pitches from strangers: web design, SEO, apps, loans, directory listings, wholesale. " +
      "Strong signs: a known brand's name with an unrelated address, odd or look-alike characters, " +
      "a failing SPF, DKIM or DMARC check in the Authentication-Results header. A passing check proves nothing: spammers sign their own domains.",
    "Mail the recipient signed up for or would expect, such as newsletters, shop mail and notifications from services they use, " +
      "or genuine personal or business correspondence."), skipKnown: true },
  recipe("jev_reply", "Needs reply", 0.6,
    "Does a person in `email` ask the recipient `me` to reply, decide, or do something?",
    "A direct question, request, invitation or deadline written by a person to `me`.",
    "Automated notifications, newsletters, receipts, FYI mail, or mail that needs nothing from `me`."),
  recipe("jev_newsletter", "Newsletter", 0.7,
    "Is `email` a newsletter, marketing campaign, or other bulk mailing?",
    "Sent to a list: newsletters, promotions, product updates, digests. Bulk mail usually has a List-Unsubscribe header.",
    "Written to the recipient individually, or a transactional message about their own account or order."),
  recipe("jev_finance", "Invoice / receipt", 0.7,
    "Is `email` an invoice, receipt, payment request, or payment confirmation?",
    "Bills, invoices, receipts, order confirmations with amounts, payment reminders.",
    "Anything that is not about a specific payment."),
  recipe("jev_urgent", "Urgent", 0.7,
    "Does `email` say that something is urgent, time-critical, or due very soon?",
    "Explicit urgency: ASAP, today, outage, final notice, a deadline that is close.",
    "No time pressure expressed."),
  recipe("jev_calendar", "Meeting / event", 0.7,
    "Is `email` an invitation to, or a change to, a meeting, call, or event?",
    "Calendar invites, reschedules, cancellations, event registrations with a date.",
    "Mail that only mentions an event in passing, or event marketing sent to a list."),
  recipe("jev_shipping", "Shipping", 0.7,
    "Is `email` a shipping, delivery, or tracking update for an order?",
    "Dispatch notices, tracking numbers, delivery attempts, pickup notices.",
    "Order confirmations without shipping news, or marketing from a shop."),
  recipe("jev_security", "Security alert", 0.7,
    "Is `email` a login alert, verification code, password reset, or other account security notice?",
    "New sign-in alerts, one-time codes, password or 2FA changes, account lock notices.",
    "Marketing or newsletters that only mention security."),
  recipe("jev_personal", "Personal", 0.7,
    "Was `email` written personally by a human to `me`, rather than sent by an automated system or to a list?",
    "A human wrote this message to the recipient, such as a friend, colleague, or customer.",
    "Automated, templated, or bulk mail."),
  recipe("jev_social", "Social", 0.7,
    "Is `email` a notification from a social network, forum, or community site?",
    "Likes, mentions, follows, comments, friend requests, digests from social sites.",
    "Direct mail from a person, or anything not from a social or community platform."),
  recipe("jev_jobs", "Jobs / recruiting", 0.7,
    "Is `email` about a job opportunity, a job application, or recruiting?",
    "Recruiter outreach, application confirmations, interview invitations, job alerts.",
    "Anything not about hiring or applying for work."),
];

const DEFAULTS = {
  apiKey: "",
  consent: false, // explicit opt-in before any mail content leaves Thunderbird (ATN policy)
  model: "jev-latest",
  autoTriage: false,
  skipTriaged: true, // triaging selected mail skips mail that already has the Triaged tag
  excludedAccounts: [], // account ids whose mail is never sent to Jev
  colorScheme: "auto", // tag colour set: "auto" follows Thunderbird's theme, or "light" / "dark"
  triagedColor: "#DFDDD9", // warm light grey on dark themes
  triagedColorLight: "#403A47", // dark plum grey on light themes
  budget: 1, // USD per calendar month; 0 = no limit
  pricePerMtok: 0.042, // USD per million input tokens (jev-1.13; output tokens are free)
  bodyChars: 3000, // most of the body sent to Jev, after cleanup; the signal is usually near the top
  recipes: RECIPE_LIBRARY.slice(0, 5),
};

// ponytail: hard cut at `max` characters; add smarter excerpting if long mails misclassify
function cleanBody(text, max = DEFAULTS.bodyChars) {
  return text
    .replace(/[\u00AD\u034F\u200B-\u200D\u2060\uFEFF]/g, "") // invisible preheader padding in marketing mail
    .replace(/https?:\/\/([^/\s>)\]]+)[^\s>)\]]*/g, "$1") // links: keep the host, drop paths and tracking tokens
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => !l.startsWith(">")) // quoted replies are noise for the current mail
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
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

// "Name <x@y.z>" -> "x@y.z". The address is the <…> at the end: the display name before it is free text and can
// hold a fake "<boss@corp.nl>". Anything that isn't one plain address gives "".
const senderEmail = (author = "") => {
  const email = (author.match(/<([^<>]*)>\s*$/)?.[1] ?? author).trim().toLowerCase();
  return /[\s,;<>"]/.test(email) ? "" : email;
};

// Did your mail server's DMARC check pass for the sender's own domain? A From address can be faked; a DMARC pass
// for that same domain can't. `authResults` is the topmost Authentication-Results header.
const dmarcPass = (authResults = "", author = "") => {
  const domain = senderEmail(author).split("@")[1];
  return !!domain && authResults.toLowerCase().split(";")
    .some((c) => /^\s*dmarc=pass\b/.test(c) && c.match(/\bheader\.from=([^\s;()]+)/)?.[1] === domain);
};

// Who wrote an Authentication-Results header: its authserv-id, the first token ("mx.google.com; dkim=pass …").
// Microsoft leaves it out ("spf=pass …; dmarc=pass …"), which gives "".
const authServId = (header = "") => {
  const first = header.split(";")[0].trim().toLowerCase();
  return first.includes("=") ? "" : first.split(/\s/)[0];
};

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
  const r = recipe(key, name, 0.7,
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
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : defaultColors(r.key)[0],
      colorLight: /^#[0-9a-f]{6}$/i.test(r.colorLight) ? r.colorLight : defaultColors(r.key)[1],
      threshold: typeof r.threshold === "number" && r.threshold >= 0 && r.threshold <= 1 ? r.threshold : 0.7,
      question: r.question,
      yes: str(r.yes),
      no: str(r.no),
      action: Object.hasOwn(ACTIONS, r.action) ? r.action : "tag",
      folder: str(r.folder),
      skipKnown: r.skipKnown === true,
      examples: (Array.isArray(r.examples) ? r.examples : [])
        .filter((e) => typeof e?.label === "boolean")
        .map((e) => ({ from: str(e.from).slice(0, HEADER_CHARS), subject: str(e.subject).slice(0, HEADER_CHARS), snippet: str(e.snippet).slice(0, 300), label: e.label }))
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

// Visible text of an HTML body: without CSS and scripts, which textContent would otherwise keep.
function htmlText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, noscript, template").forEach((e) => e.remove());
  return doc.body.textContent;
}

async function emailState(id, bodyChars) {
  const m = await messenger.messages.get(id);
  const parts = await messenger.messages.listInlineTextParts(id);
  const plain = parts.find((p) => p.contentType === "text/plain");
  const html = parts.find((p) => p.contentType === "text/html");
  const body = plain ? plain.content : html ? htmlText(html.content) : "";
  const identity = m.folder ? await messenger.identities.getDefault(m.folder.accountId) : null;
  // Only the topmost header: your own mail server adds it, lower ones can be forged by the sender.
  const { headers } = await messenger.messages.getFull(id);
  const header = (name) => headers[name]?.[0]?.slice(0, HEADER_CHARS);
  // Everything the sender writes is capped: this ends up in every request, and in examples that ride along in later ones.
  const cut = (text = "") => text.slice(0, HEADER_CHARS);
  const cutList = (list = []) => list.slice(0, MAX_RECIPIENTS).map(cut);
  return {
    me: identity?.email ?? "",
    email: {
      from: cut(m.author), to: cutList(m.recipients), cc: cutList(m.ccList), subject: cut(m.subject), body: cleanBody(body, bodyChars),
      headers: { "Authentication-Results": header("authentication-results"), "List-Unsubscribe": header("list-unsubscribe") },
    },
  };
}

async function classify(id, settings) {
  // Consent and budget are read fresh, so changing them in the manager takes effect mid-batch.
  // Their errors have cause "halt": the rest of a batch would fail the same way.
  const { consent, budget } = await messenger.storage.local.get({ consent: DEFAULTS.consent, budget: DEFAULTS.budget });
  if (!consent) throw new Error("Allow sending mail to TypeSafe first (JevIt manager, top of the page).", { cause: "halt" });
  const month = monthOf();
  if (budgetLeft({ budget }, await loadUsage(), month) <= 0) {
    throw new Error(`Monthly Jev budget of ${money(budget)} reached. Raise it in the JevIt manager, or wait for next month.`, { cause: "halt" });
  }
  const state = await emailState(id, settings.bodyChars);
  const [response, known] = await Promise.all([
    askJev(settings, state, questionsFor(settings.recipes)),
    // A failing lookup must not fail the triage: the Jev request is already paid for. Treat as unknown.
    // Without a DMARC pass from your own mail server the From address may be faked, so the sender doesn't count as known.
    settings.recipes.some((r) => r.skipKnown) && dmarcPass(state.email.headers["Authentication-Results"], state.email.from)
      ? trustedHeader(id, state.email.headers["Authentication-Results"])
        .then((trusted) => trusted && knownSender(state.email.from))
        .catch((e) => (console.warn("JevIt: known-sender check failed", e), false))
      : false,
  ]);
  // ponytail: read-modify-write; a popup and a background batch finishing at the same moment can drop one count
  const usage = addUsage(await loadUsage(), month, response.usage?.input_tokens ?? 0, settings.pricePerMtok);
  await messenger.storage.local.set({ usage });
  return { state, answers: response.answers, known, keys: decide(settings.recipes, response.answers, known) };
}

// Was this mail's topmost Authentication-Results header written by the account's own mail server? A server that
// doesn't add one leaves the sender's (possibly forged) header on top.
async function trustedHeader(id, header) {
  const { folder } = await messenger.messages.get(id);
  return !!folder && authServId(header) === (await trustedServer(folder.accountId));
}

// The account's own mail server, as the authserv-id on most of its recent Inbox mail: a sender can forge the header
// on their own mail, not on most of yours. null without a clear winner, e.g. when the server adds no header at all.
// Checked locally, cached per account for a week in `authServers` (the manager shows it).
const AUTH_SAMPLE = 5;
async function trustedServer(accountId) {
  const { authServers = {} } = await messenger.storage.local.get("authServers");
  const cached = authServers[accountId];
  if (cached && Date.now() - cached.at < 7 * 864e5) return cached.id;
  const inbox = (await messenger.folders.query({ accountId, specialUse: ["inbox"] })).map((f) => f.id);
  const found = inbox.length ? await messenger.messages.query({ folderId: inbox, fromDate: new Date(Date.now() - 90 * 864e5), messagesPerPage: AUTH_SAMPLE }) : [];
  const counts = new Map();
  let sampled = 0;
  for (const m of (found.messages ?? found).slice(0, AUTH_SAMPLE)) {
    const header = (await messenger.messages.getFull(m.id)).headers["authentication-results"]?.[0];
    const key = header === undefined ? null : authServId(header);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    sampled++;
  }
  const [best, n = 0] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  const id = best != null && n >= 3 && n > sampled / 2 ? best : null;
  await messenger.storage.local.set({ authServers: { ...authServers, [accountId]: { id, at: Date.now() } } });
  return id;
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
// `triaged`: Jev judged this mail, so it also gets the Triaged tag (kept on later re-triage or teaching).
// Tags must exist first: call syncTags(settings) before a batch.
async function applyRecipes(id, recipes, keys, answers, triaged = false) {
  const extra = triaged ? [TRIAGED] : [];
  const ours = new Set(recipes.map((r) => r.key));
  const m = await messenger.messages.get(id);
  const { update, folder } = plan(recipes, keys, answers);
  const tags = new Set([...m.tags.filter((t) => !ours.has(t)), ...keys, ...extra.map((t) => t.key)]);
  await messenger.messages.update(id, { ...update, tags: [...tags] });
  const target = folder && m.folder ? await resolveFolder(folder, m.folder.accountId) : folder;
  if (target && target !== m.folder?.id) await messenger.messages.move([id], target);
}

// "light" or "dark": the chosen colour set, or Thunderbird's current theme when set to follow it.
const activeScheme = (settings) =>
  settings.colorScheme === "light" || settings.colorScheme === "dark"
    ? settings.colorScheme
    : globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === false ? "light" : "dark";

// A recipe's tag colour in a scheme. Recipes saved before light colours existed use the default light colour.
const colorFor = (r, scheme) => (scheme === "light" ? r.colorLight ?? defaultColors(r.key)[1] : r.color);

// Create missing JevIt tags and give every JevIt tag its name and colour for the active scheme.
async function syncTags(settings) {
  const scheme = activeScheme(settings);
  const triaged = { ...TRIAGED, color: settings.triagedColor, colorLight: settings.triagedColorLight };
  const existing = new Map((await messenger.messages.tags.list()).map((t) => [t.key, t]));
  for (const r of [...settings.recipes, triaged]) {
    const color = colorFor(r, scheme).toUpperCase();
    const tag = existing.get(r.key);
    if (!tag) await messenger.messages.tags.create(r.key, r.name, color);
    else if (tag.tag !== r.name || tag.color?.toUpperCase() !== color) await messenger.messages.tags.update(r.key, { tag: r.name, color });
  }
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
  module.exports = { DEFAULTS, RECIPE_LIBRARY, cleanBody, questionFor, questionsFor, decide, dmarcPass, plan, addExample, draftRecipe, parseBackup, askJev, resolveFolder, applyRecipes, knownSender, emailState, authServId, trustedServer, addUsage, budgetLeft, money, syncTags, colorFor, activeScheme, PALETTE };
}
