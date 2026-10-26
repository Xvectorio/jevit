// Shared triage logic for background, popup and options pages (plain script, no bundler).
const JEV_API = "https://api.typesafe.ai/v1/systemone";
// Where mail can go: a fixed choice, so the manifest names every host and the consent text names who receives it.
const OPENROUTER_API = "https://openrouter.ai/api/v1/systemone";
const LOCAL_PORT = 8791;
const localApi = (port = LOCAL_PORT) => `http://127.0.0.1:${port}/v1/systemone`; // an Open-Jev server on this computer
const SERVICES = {
  typesafe: { name: "TypeSafe", host: "api.typesafe.ai", keys: "typesafe.ai" },
  openrouter: { name: "OpenRouter", host: "openrouter.ai", keys: "openrouter.ai/keys" },
  local: { name: "Open-Jev", host: "127.0.0.1" }, // a key is optional
};
const serviceOf = (endpoint = JEV_API) =>
  endpoint === OPENROUTER_API ? "openrouter" : endpoint.startsWith("http://127.0.0.1:") ? "local" : "typesafe";

// Who receives the mail, as the consent text says it. OpenRouter passes it on to the model's provider:
// TypeSafe for Jev ("jev-latest", "typesafe/jev-1.13"), someone else for a model like "openai/…".
function receiver(endpoint, model = "") {
  const service = serviceOf(endpoint);
  if (service !== "openrouter") return `${SERVICES[service].name} (${SERVICES[service].host})`;
  const author = model.includes("/") ? model.split("/")[0].replace(/^~/, "") : "typesafe";
  return author === "typesafe"
    ? "OpenRouter (openrouter.ai), which passes it to TypeSafe"
    : `OpenRouter (openrouter.ai) and ${author}, the provider of ${model}`;
}

// Why triage can't ask Jev yet, or "" when it can.
function connectionProblem({ endpoint, apiKey, consent }) {
  const service = serviceOf(endpoint);
  return !apiKey && service !== "local" ? `no ${SERVICES[service].name} API key is set`
    : !consent ? `sending mail to ${SERVICES[service].name} is not allowed yet`
    : "";
}

// The key field is write-only: a saved key is never loaded back into the page. An empty field keeps the stored key,
// a typed key replaces it, and only Remove key clears it. `apiKey` is the key of service `from` (the stored one),
// `apiKeys` every service's. Returns both after the field is saved and the service goes from `from` to `to`.
function storeKey({ apiKey = "", apiKeys = {} }, from, to, typed, remove = false) {
  const keys = { ...apiKeys, [from]: remove ? "" : typed.trim() || apiKey };
  return { apiKey: keys[to] ?? "", apiKeys: keys };
}
// That a key is saved, without showing it: its last 4 characters, or none of a short key.
const keySaved = (key) => (key.length < 8 ? "Key saved" : `Key saved, ending in …${key.slice(-4)}`);
const HEADER_CHARS = 1000; // per header (and per address, subject, sender), so a sender can't inflate the request
const MAX_RECIPIENTS = 20; // To and Cc each; enough to tell a personal mail from a mass mailing
const MAX_EXAMPLES = 20; // per recipe, newest kept; examples ride along in every request (~100 tokens each)
const MAX_LINKS = 10; // link hosts per mail; phishing gives itself away in where links go, not in what they say
const MAX_ATTACHMENTS = 10; // attachment names and types per mail, not their contents

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
const TRIAGED = { key: "jev_triaged", name: "Triaged" }; // tag on every mail Jev has judged; name and colour are settings
// Mail Jev was unsure about, to review and teach from; the name is a setting. Amber: 11:1 on a dark background, 5.9:1 on white.
const UNSURE = { key: "jev_unsure", name: "Unsure", color: "#FFC857", colorLight: "#8A5A00" };

// Tag colours as [dark theme, light theme]. Thunderbird colours the message row text with the tag colour,
// so each recipe has two. Dark set: one hue each at the same pale lightness (HSL h/100%/92%), a hint of
// colour on a dark background (12-16:1 contrast). Light set: the same hues, darkened to >= 5.2:1 on white.
// Spam is the exception: plainly red on both (6.2:1 on dark), so it stands out.
const PALETTE = {
  jev_spam: ["#FF6B6B", "#D31717"],
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
  jev_phishing: ["#FFDDD6", "#CA3416"],
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
      "links, Reply-To or attachments that don't fit the sender (see `links`, `attachments`), " +
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
    "Anything that is not about a specific payment, and fake invoices or payment requests: " +
      "a sender pretending to be a company, whose address, Reply-To or links belong to an unrelated domain."),
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
    "Marketing or newsletters that only mention security, and phishing: " +
      "fake alerts whose sender, Reply-To or links belong to a domain other than the company they name."),
  recipe("jev_phishing", "Phishing", 0.7,
    "Does `email` pretend to come from a company, service or person, to get `me` to log in, pay, share personal data, or open a file?",
    "Fake notices from a bank, shop, mail or storage provider, delivery service, government agency or colleague, " +
      "where the sender, Reply-To or link hosts (see `links`) belong to an unrelated domain. " +
      "Attachments that are web pages, archives or disk images posing as documents.",
    "Genuine mail from who it says it is from, with sender and link hosts that belong to them. " +
      "Ordinary spam and scams that don't pretend to be someone else."),
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

// Earlier library wording, as [key, field, old text]. On update, a saved recipe whose field still has exactly that
// text gets the current library text. A field the user edited, even slightly, is never touched; nor are thresholds,
// actions, folders, colours or examples.
// ponytail: entries stay until most users have updated; someone who skips that release just keeps the old wording
const LIBRARY_UPDATES = [
  ["jev_spam", "yes", "Phishing: `me`'s mailbox, password, storage, wallet or bank account supposedly needs action, from an address that doesn't belong to that company. Fake business mail: purchase orders, quotes, invoices or payment proofs `me` never asked for, often a \"RE:\" without an earlier conversation. Scams: prizes, gift cards, inheritances, dating approaches, miracle health or bargain products. Cold sales pitches from strangers: web design, SEO, apps, loans, directory listings, wholesale. Strong signs: a known brand's name with an unrelated address, odd or look-alike characters, a failing SPF, DKIM or DMARC check in the Authentication-Results header. A passing check proves nothing: spammers sign their own domains."],
  ["jev_finance", "no", "Anything that is not about a specific payment."],
  ["jev_security", "no", "Marketing or newsletters that only mention security."],
];

// Bring saved recipes up to date with the library where the user kept the default text. true if anything changed.
function updateRecipes(recipes) {
  let changed = false;
  for (const [key, field, old] of LIBRARY_UPDATES) {
    const r = recipes.find((r) => r.key === key);
    if (r?.[field] === old) (r[field] = RECIPE_LIBRARY.find((l) => l.key === key)[field]), (changed = true);
  }
  return changed;
}

const DEFAULTS = {
  apiKey: "",
  consent: false, // explicit opt-in before any mail content leaves Thunderbird (ATN policy)
  model: "jev-latest",
  endpoint: JEV_API, // OPENROUTER_API, or localApi(port). Other services' keys are kept in `apiKeys`, outside the settings
  autoTriage: false,
  skipTriaged: true, // triaging selected mail skips mail Jev already judged: Triaged tag or stored scores
  triagedTag: true, // tag every judged mail Triaged. Thunderbird fills a selected row with its first tag's colour, so off keeps untouched mail looking as before
  excludedAccounts: [], // account ids whose mail is never sent to Jev
  colorScheme: "auto", // tag colour set: "auto" follows Thunderbird's theme, or "light" / "dark"
  triagedName: TRIAGED.name, // the Triaged tag's name in Thunderbird; renaming it there is undone by the next tag sync
  triagedColor: "#FFFFFF", // close to Thunderbird's own text colour, so triaged mail looks as before
  triagedColorLight: "#000000",
  budget: 1, // USD per calendar month; 0 = no limit
  pricePerMtok: 0.042, // USD per million input tokens (jev-1.13; output tokens are free)
  bodyChars: 3000, // most of the body sent to Jev, after cleanup; the signal is usually near the top
  actSure: 0.9, // a match below this only tags: star, mark read, junk and move wait until Jev is this sure. 0 = always act
  unsureMargin: 0.15, // mail this close under a recipe's threshold gets the Unsure tag. 0 = no Unsure tag
  unsureName: UNSURE.name,
  recipes: RECIPE_LIBRARY.slice(0, 5),
};

// Links written out in text, down to where they go: a web link keeps only its host (no user:password@, port, path,
// query or #fragment), a mailto: link only its address. Punctuation ending the sentence stays.
// A link the URL parser rejects still loses everything around its host-like part, never kept as written.
function linksToHosts(text) {
  return text.replace(/(?:https?:\/\/|mailto:)[^\s>)\]]+/gi, (link) => {
    const [, url, tail] = link.match(/^(.*?)([.,;:!?'"]*)$/s);
    if (/^mailto:/i.test(url)) return url.slice(7).split(/[?#]/)[0] + tail;
    try { return new URL(url).hostname + tail; } catch {}
    const authority = url.replace(/^[a-z]+:\/\//i, "").split(/[/\\?#]/)[0];
    return authority.slice(authority.lastIndexOf("@") + 1).split(":")[0] + tail;
  });
}

// ponytail: hard cut at `max` characters; add smarter excerpting if long mails misclassify
function cleanBody(text, max = DEFAULTS.bodyChars) {
  const visible = text.replace(/[\u00AD\u034F\u200B-\u200D\u2060\uFEFF]/g, ""); // invisible preheader padding in marketing mail
  return linksToHosts(visible)
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

// Jev's scores are kept locally, so judging an email again is free: the header popup, or triaging mail again after
// changing a threshold. A score belongs to the exact email Jev saw and the exact question (model, recipe question,
// criteria and examples): editing or teaching a recipe makes its old scores stale. Keyed by a hash of the email,
// not its Message-ID: the sender picks that, and could borrow the scores of mail you trust.
// Another endpoint (OpenRouter, a local Open-Jev server) keeps its own scores; TypeSafe's keep their original keys.
// Kept for SCORE_DAYS after Jev was last asked about the email (reuse doesn't extend it); pruneScores() runs at startup.
const SCORE_DAYS = 90;
const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const scoreKey = async (state, endpoint) => `score:${await digest(!endpoint || endpoint === JEV_API ? state : [endpoint, state])}`;
const questionSigs = (recipes, model) => Promise.all(recipes.map((r) => digest([model, questionFor(r)])));

// Answers from stored scores, and the recipes Jev still has to be asked. `sigs` from questionSigs(recipes).
function reuse(recipes, sigs, stored = {}) {
  const answers = {}, missing = [];
  recipes.forEach((r, i) => (Object.hasOwn(stored, sigs[i]) ? (answers[r.key] = { noul: stored[sigs[i]] }) : missing.push(r)));
  return { answers, missing };
}

// Jev's yes-probability in an answer, or undefined when it isn't a number from 0 to 1: Jev's answer is checked, not trusted.
const noulOf = (answer) => (typeof answer?.noul === "number" && answer.noul >= 0 && answer.noul <= 1 ? answer.noul : undefined);

// The answers in Jev's response that hold a score, for the recipes it was asked about. Anything else is left out.
const scoresIn = (recipes, answers) =>
  Object.fromEntries(recipes.flatMap((r) => (noulOf(answers?.[r.key]) === undefined ? [] : [[r.key, answers[r.key]]])));

// The scores to store for an email: one per current recipe, so stale ones are dropped.
const remember = (recipes, sigs, answers) =>
  Object.fromEntries(recipes.flatMap((r, i) => (noulOf(answers[r.key]) === undefined ? [] : [[sigs[i], noulOf(answers[r.key])]])));

// Remove stored scores older than SCORE_DAYS. Entries without a time count as old; pruneScores(Infinity) removes all.
async function pruneScores(now = Date.now()) {
  const all = await messenger.storage.local.get(null);
  const old = Object.keys(all).filter((k) => k.startsWith("score:") && !(now - all[k]?.at < SCORE_DAYS * 864e5));
  if (old.length) await messenger.storage.local.remove(old);
}

// Recipe keys whose yes-probability clears that recipe's threshold. A recipe set to skip known senders
// never matches mail from someone you know, whatever Jev says.
function decide(recipes, answers, known = false) {
  return recipes.filter((r) => noulOf(answers[r.key]) >= r.threshold && !(known && r.skipKnown)).map((r) => r.key);
}

// How sure Jev was about the matches. A match under `actSure` only tags: a wrong tag is easy to spot, a wrong move
// to Junk hides the mail. `unsure`: a match held back like that, or a recipe that scored just under its threshold.
// Those mails are the ones worth teaching Jev from.
function certainty(recipes, answers, keys, { actSure = 0, unsureMargin = 0 } = {}) {
  const p = (r) => noulOf(answers[r.key]) ?? 0;
  const act = recipes.filter((r) => keys.includes(r.key) && (r.action === "tag" || p(r) >= actSure)).map((r) => r.key);
  const unsure = unsureMargin > 0 && recipes.some((r) =>
    keys.includes(r.key) ? !act.includes(r.key) : p(r) < r.threshold && p(r) >= r.threshold - unsureMargin);
  return { act, unsure };
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
    .sort((a, b) => (noulOf(answers[b.key]) ?? 0) - (noulOf(answers[a.key]) ?? 0))[0];
  return {
    update: { ...(has("read") && { read: true }), ...(has("flag") && { flagged: true }), ...(has("junk", "junkmove") && { junk: true }) },
    folder: move?.folder ?? null,
  };
}

// An example is a mail's sender, subject and start of its text, with your yes or no. The same mail taught again
// replaces its example: a second click doesn't count it twice, and a corrected answer doesn't contradict the old one.
const exampleOf = (email, label) => ({ from: email.from, subject: email.subject, snippet: email.body.slice(0, 300), label });
const sameMail = (a, b) => a.from === b.from && a.subject === b.subject && a.snippet === b.snippet;
const withExample = (examples, example) => [...examples.filter((e) => !sameMail(e, example)), example].slice(-MAX_EXAMPLES);
function addExample(recipe, email, label) {
  recipe.examples = withExample(recipe.examples, exampleOf(email, label));
}

// A recipe's examples in the manager, with the stored ones it hasn't seen yet (`seen`: what it last read from storage)
// added: taught from the menu or the popup while it was open. Examples it took out (✕, Forget examples) stay out.
function mergeExamples(mine, stored = [], seen = []) {
  const has = (list, e) => list.some((x) => sameMail(x, e) && x.label === e.label);
  return stored.filter((e) => !has(seen, e) && !has(mine, e)).reduce(withExample, mine);
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

// Runs fn once the previous serial() call has settled: parallel triage shares the usage counters and folders.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// Unticking consent, or another service or model, also aborts the requests already on their way, not only the next
// ones: storage.onChanged reaches every JevIt page, so this covers the popup as well as a running triage.
let halt = new AbortController();
function haltRequests(changes) {
  const changed = (key) => key in changes && changes[key].newValue !== changes[key].oldValue;
  const why = changed("consent") && !changes.consent.newValue ? "Sending mail was stopped: consent was unticked in the JevIt manager."
    : changed("endpoint") || changed("model") ? "The service or model changed in the JevIt manager. Triage again to use it."
    : "";
  if (!why) return;
  halt.abort(new Error(why, { cause: "halt" }));
  halt = new AbortController();
}
globalThis.messenger?.storage?.onChanged.addListener(haltRequests);

const REQUEST_SECONDS = 60; // per attempt: a request that hangs fails its mail instead of holding up the batch

// A wait that ends early, with the signal's reason, when it aborts.
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const abort = () => (clearTimeout(timer), reject(signal.reason));
  const timer = setTimeout(() => (signal?.removeEventListener("abort", abort), resolve()), ms);
  signal?.addEventListener("abort", abort, { once: true });
});

// `signal` aborts the request and its waits between retries (triage's Stop, consent unticked).
// An error with `maybePaid` cut off a request Jev already had (stopped, timed out): it may be charged.
// What a failed request's reply says, kept short for notifications and the error log: the message of a JSON error
// ({ error: { message } }, { error }, { message } or { detail }), or else the reply's text without HTML tags.
// A proxy's or captive portal's whole web page shouldn't end up there.
function replyReason(text = "") {
  let json;
  try { json = JSON.parse(text); } catch {}
  const said = [json?.error?.message, json?.error, json?.message, json?.detail].find((s) => typeof s === "string");
  return (said ?? text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200);
}

async function askJev({ apiKey, model, endpoint }, state, questions, signal) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(REQUEST_SECONDS * 1000);
    const cut = (maybePaid) => (e) => {
      if (!signal?.aborted && !timeout.aborted) throw e;
      const why = signal?.aborted ? signal.reason : { message: `Jev didn't answer within ${REQUEST_SECONDS} seconds` };
      throw Object.assign(new Error(why.message, { cause: why.cause }), { maybePaid }); // a copy: parallel mails share the reason
    };
    const r = await fetch(endpoint || JEV_API, {
      method: "POST",
      redirect: "error", // mail and key go to this endpoint only, never on to where it redirects
      headers: { ...(apiKey && { Authorization: `Bearer ${apiKey}` }), "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch(cut(true));
    if ((r.status === 429 || r.status === 529) && attempt < 4) {
      await wait(1000 * 2 ** attempt, signal);
      continue;
    }
    if (!r.ok) {
      const reason = replyReason(await r.text().catch(cut(false)));
      throw new Error(`Jev ${r.status}${reason ? `: ${reason}` : ""}`);
    }
    return r.json().catch(cut(true)); // { model, answers, usage: { input_tokens, output_tokens } }
  }
}

// --- Usage and budget (estimated from the token counts Jev returns) ---

const monthOf = (date = new Date()) => date.toISOString().slice(0, 7); // "2026-09"
// "September 2026" for "2026-09": the budget's month is UTC, so its name is too, also late on the last day of a month.
const monthName = (month = monthOf(), locale = undefined) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
const money = (usd) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(5) : usd.toFixed(2)}`;
const emptyUsage = () => ({ requests: 0, inputTokens: 0, cost: 0 });

// Counters after one more request: this month's (restarting when the month changes) and all-time.
// OpenRouter reports what a request cost; otherwise it's estimated from the input tokens.
// `requests` 0 corrects a request counted before its answer, -1 takes it back; counters don't go below 0.
function addUsage(usage, month, inputTokens, pricePerMtok, reported, requests = 1) {
  const cost = typeof reported === "number" ? reported : (inputTokens * pricePerMtok) / 1e6;
  const add = (u) => ({ requests: Math.max(0, u.requests + requests), inputTokens: Math.max(0, u.inputTokens + inputTokens), cost: Math.max(0, u.cost + cost) });
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

// Runs fn on the background page, one at a time with its other serial() calls. Each page has its own serial() queue,
// so a popup or the manager changing storage at the same moment as a triage or teach could lose one change: other
// pages send `message` there instead, and the background page answers it by making the same call (background.js).
function inBackground(message, fn) {
  const background = globalThis.messenger?.extension?.getBackgroundPage?.();
  if (background && background !== globalThis) return messenger.runtime.sendMessage(message);
  return serial(fn);
}

// Counts a change to the usage (addUsage's arguments). With `budget`, only while this month's budget isn't used up:
// returns whether it was counted, so checking and counting are one step and parallel mails can't all slip past.
// The background page does every count (inBackground).
function countUsage(change, budget) {
  return inBackground({ countUsage: [change, budget] }, async () => {
    const usage = await loadUsage(), month = monthOf(), { inputTokens, pricePerMtok, reported, requests } = change;
    if (budget !== undefined && budgetLeft({ budget }, usage, month) <= 0) return false;
    await messenger.storage.local.set({ usage: addUsage(usage, month, inputTokens, pricePerMtok, reported, requests) });
    return true;
  });
}

const loadSettings = () => messenger.storage.local.get(DEFAULTS);

// Recipes are written on the background page only, one write at a time, each on the recipes read fresh from storage
// (inBackground). Otherwise a teach, an Apply and a Save would each write the whole list they started from, and the
// last one would drop the others' changes.

// Stores examples ({ key, example }) taught from the menu, a shortcut or the popup into the recipes they're for.
// A recipe removed meanwhile gets none. Returns how many were stored.
function learn(taught) {
  return inBackground({ learn: [taught] }, async () => {
    const { recipes } = await messenger.storage.local.get({ recipes: DEFAULTS.recipes });
    let stored = 0;
    const changed = recipes.map((r) => {
      const added = taught.filter((t) => t.key === r.key).map((t) => t.example);
      stored += added.length;
      return added.length ? { ...r, examples: added.reduce(withExample, r.examples) } : r;
    });
    if (stored) await messenger.storage.local.set({ recipes: changed });
    return stored;
  });
}

// Save in the manager: its settings, keeping the examples stored since it last read them (mergeExamples; `seen` holds
// what it read, by recipe key). Returns the recipes as saved.
function saveSettings(settings, seen) {
  return inBackground({ saveSettings: [settings, seen] }, async () => {
    const { recipes: stored = [] } = await messenger.storage.local.get("recipes");
    const recipes = settings.recipes.map((r) =>
      ({ ...r, examples: mergeExamples(r.examples, stored.find((x) => x.key === r.key)?.examples, seen[r.key]) }));
    await messenger.storage.local.set({ ...settings, recipes });
    return recipes;
  });
}

// "Log in to PayPal → evil.example": what a link says, next to the host it really goes to. One entry per host, in order.
// Links without a host (relative, mailto:, javascript:) are left out. Hosts come out in punycode, so look-alikes show.
// A link text that is itself a URL ("https://paypal.com/reset?token=…") is cut down to its host like the body.
function linkHosts(anchors) {
  const seen = new Set();
  return anchors.flatMap(({ href, text }) => {
    let host = "";
    try { host = new URL(href).hostname; } catch {}
    if (!host || seen.has(host)) return [];
    seen.add(host);
    return [`${linksToHosts(text.replace(/\s+/g, " ").trim()).slice(0, 80)} → ${host}`.trim()];
  }).slice(0, MAX_LINKS);
}

// Whether an inline style hides its element: display:none, visibility:hidden, opacity or font-size 0, or a height
// of 0 with overflow hidden. "!important", spacing and case don't matter.
function hiddenStyle(style = "") {
  const css = Object.fromEntries(style.split(";").map((d) => d.split(":").map((s) => s.replace(/!\s*important/i, "").trim().toLowerCase())));
  const zero = (v) => parseFloat(v) === 0;
  return css.display === "none" || css.visibility === "hidden" || zero(css.opacity) || zero(css["font-size"]) ||
    ((zero(css.height) || zero(css["max-height"])) && css.overflow === "hidden");
}

// Removes what the reader doesn't see, with everything inside it, so its text and links aren't sent and can't sway the
// score. A guess from inline styles and the hidden attribute only: DOMParser lays nothing out, and <style> rules aren't read.
function stripHidden(doc) {
  doc.querySelectorAll("[hidden], [style]").forEach((e) => (e.hasAttribute("hidden") || hiddenStyle(e.getAttribute("style"))) && e.remove());
}

// Text of an HTML body: without CSS and scripts, which textContent would otherwise keep.
function htmlText(doc) {
  doc.querySelectorAll("style, script, noscript, template").forEach((e) => e.remove());
  return doc.body.textContent;
}

// Attachments in getFull()'s MIME tree, for when listAttachments() fails. Attachments have a name (maybe empty).
// An attached message is listed but not entered: only names and types are sent, never its contents.
const mimeAttachments = (parts = []) =>
  parts.flatMap((p) => (Object.hasOwn(p, "name") || p.contentType?.startsWith("message/") ? [p] : mimeAttachments(p.parts)));

async function emailState(id, bodyChars) {
  const m = await messenger.messages.get(id);
  const parts = await messenger.messages.listInlineTextParts(id);
  const plain = parts.find((p) => p.contentType === "text/plain");
  const html = parts.find((p) => p.contentType === "text/html");
  // Links come from the HTML part even when the plain part is the body: that's where the sender can hide where they go.
  // Hidden elements go first, so hidden links can't push the real ones out of the MAX_LINKS.
  const doc = html && new DOMParser().parseFromString(html.content, "text/html");
  if (doc) stripHidden(doc);
  const links = doc ? linkHosts([...doc.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent }))) : [];
  const body = plain ? plain.content : doc ? htmlText(doc) : "";
  const full = await messenger.messages.getFull(id);
  // Thunderbird can fail to list a bounce's attachments (message/delivery-status); the MIME tree still has them.
  const listed = await messenger.messages.listAttachments(id).catch((e) => {
    if (!full.parts) throw e;
    return mimeAttachments(full.parts);
  });
  const attachments = listed.slice(0, MAX_ATTACHMENTS).map((a) => `${a.name ?? ""} (${a.contentType})`.slice(0, 200));
  const identity = m.folder ? await messenger.identities.getDefault(m.folder.accountId) : null;
  // Only the topmost header: your own mail server adds it, lower ones can be forged by the sender.
  const { headers } = full;
  const header = (name) => headers[name]?.[0]?.slice(0, HEADER_CHARS);
  // Everything the sender writes is capped: this ends up in every request, and in examples that ride along in later ones.
  const cut = (text = "") => text.slice(0, HEADER_CHARS);
  const cutList = (list = []) => list.slice(0, MAX_RECIPIENTS).map(cut);
  // List-Unsubscribe links carry a personal token; that there is one, and its host, is the signal.
  const unsubscribe = header("list-unsubscribe");
  return {
    me: identity?.email ?? "",
    email: {
      from: cut(m.author), to: cutList(m.recipients), cc: cutList(m.ccList), subject: cut(m.subject), body: cleanBody(body, bodyChars),
      links, attachments,
      headers: { "Authentication-Results": header("authentication-results"), "List-Unsubscribe": unsubscribe && linksToHosts(unsubscribe), "Reply-To": header("reply-to") },
    },
  };
}

// Has Jev judged this exact email before (stored scores, kept SCORE_DAYS)? Works without the Triaged tag.
// Not when no score was kept, or when the triage they came from didn't finish (`retry`): triaging it again redoes it.
async function judgedBefore(id, bodyChars, endpoint) {
  const key = await scoreKey(await emailState(id, bodyChars), endpoint);
  const stored = (await messenger.storage.local.get(key))[key];
  return !!stored && !stored.retry && Object.entries(stored).some(([sig, noul]) => sig !== "at" && typeof noul === "number");
}

// Marks an email's stored scores (`key` from classify) as from a triage that didn't finish, or as finished again.
// Marked scores are still reused for free; they only stop "Skip already triaged mail" from skipping the email.
async function markRetry(key, retry) {
  const { [key]: stored } = await messenger.storage.local.get(key);
  if (!stored || !!stored.retry === retry) return;
  const { retry: _, ...scores } = stored;
  await messenger.storage.local.set({ [key]: retry ? { ...scores, retry } : scores });
}

// Consent, budget and connection are read fresh, so changing them in the manager takes effect mid-batch; `signal` is
// checked with them. Their errors have cause "halt": the rest of a batch would fail the same way. Returns what was read.
async function allowed(settings, signal) {
  signal?.throwIfAborted();
  const now = await messenger.storage.local.get({ consent: DEFAULTS.consent, budget: DEFAULTS.budget, endpoint: DEFAULTS.endpoint, model: DEFAULTS.model });
  signal?.throwIfAborted();
  if (!now.consent) throw new Error(`Allow sending mail to ${SERVICES[serviceOf(now.endpoint)].name} first (JevIt manager, top of the page).`, { cause: "halt" });
  // Consent given for another service or model doesn't cover the one this batch started with.
  if (now.endpoint !== settings.endpoint || now.model !== settings.model) {
    throw new Error("The service or model changed in the JevIt manager. Triage again to use it.", { cause: "halt" });
  }
  return now;
}

// One request to Jev, counted before it's sent: a guess at its tokens counts while there's budget left, and is corrected
// to what Jev reports. So parallel mails can't all start on the last cents of a budget; at most one request goes past it.
// A request that didn't reach Jev, or that Jev refused, is taken back. One cut off on its way may be charged: it stays.
async function askCounted(settings, budget, state, questions, signal) {
  const tokens = Math.ceil(JSON.stringify({ state, questions }).length / 4), { pricePerMtok } = settings; // ~4 characters a token
  if (!(await countUsage({ inputTokens: tokens, pricePerMtok }, budget))) {
    throw new Error(`Monthly Jev budget of ${money(budget)} reached. Raise it in the JevIt manager, or wait for next month.`, { cause: "halt" });
  }
  let response;
  try {
    await allowed(settings, signal); // once more, right before the mail leaves
    response = await askJev(settings, state, questions, signal);
  } catch (e) {
    if (!e.maybePaid) await countUsage({ inputTokens: -tokens, pricePerMtok, requests: -1 });
    throw e;
  }
  const { input_tokens = 0, cost } = response?.usage ?? {};
  const reported = typeof cost === "number" ? cost - (tokens * pricePerMtok) / 1e6 : undefined;
  await countUsage({ inputTokens: input_tokens - tokens, pricePerMtok, reported, requests: 0 });
  return response;
}

// `stopped` is the caller's signal: triage's Stop. It and haltRequests abort a request on its way, and an answer that
// comes back after either is dropped: no stored scores, and nothing for the caller to tag.
async function classify(id, settings, stopped) {
  const signal = stopped ? AbortSignal.any([halt.signal, stopped]) : halt.signal;
  const { budget } = await allowed(settings, signal);
  const state = await emailState(id, settings.bodyChars).catch(during("Reading the mail"));
  const key = await scoreKey(state, settings.endpoint);
  const [sigs, stored] = await Promise.all([questionSigs(settings.recipes, settings.model), messenger.storage.local.get(key).then((o) => o[key])]);
  const { answers: kept, missing } = reuse(settings.recipes, sigs, stored);
  // Only a request costs money: stored scores are reused even when the budget is used up.
  const [response, known] = await Promise.all([
    missing.length ? askCounted(settings, budget, state, questionsFor(missing), signal) : null,
    // A failing lookup must not fail the triage: the Jev request is already paid for. Treat as unknown.
    // Without a DMARC pass from your own mail server the From address may be faked, so the sender doesn't count as known.
    settings.recipes.some((r) => r.skipKnown) && dmarcPass(state.email.headers["Authentication-Results"], state.email.from)
      ? trustedHeader(id, state.email.headers["Authentication-Results"])
        .then((trusted) => trusted && knownSender(state.email.from))
        .catch((e) => (console.warn("JevIt: known-sender check failed", e), false))
      : false,
  ]);
  await allowed(settings, signal);
  // Only answers with a numeric score count. A response without any fails the mail and stores nothing, so triaging it
  // again asks again (the request stays counted); a partial one keeps the scores it has.
  const fresh = scoresIn(missing, response?.answers);
  if (missing.length && !Object.keys(fresh).length) throw new Error("Reading Jev's answer: it has no scores");
  const answers = { ...kept, ...fresh };
  // A `retry` mark (markRetry) stays until a triage finishes: the popup asks Jev too, but doesn't move the mail.
  if (response) await messenger.storage.local.set({ [key]: { ...remember(settings.recipes, sigs, answers), at: Date.now(), ...(stored?.retry && { retry: true }) } });
  const keys = decide(settings.recipes, answers, known);
  // A recipe that can't match this sender can't be unsure about it either.
  const open = settings.recipes.filter((r) => !(known && r.skipKnown));
  return { state, key, retry: !!stored?.retry, answers, known, keys, paid: !!response, ...certainty(open, answers, keys, settings) };
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

// Set this extension's tags (leaving the user's other tags alone), then run the actions of the recipes in `act`.
// `triaged`: Jev judged this mail, so it also gets the Triaged tag (kept on later re-triage or teaching). A failed
// move takes it off again: the triage didn't finish. The folder is found first, so a folder that can't be made
// fails the mail before anything changes.
// `unsure` adds the Unsure tag; any other call removes it, because the user has now judged the mail.
// Tags must exist first: call syncTags(settings) before a batch.
async function applyRecipes(id, recipes, keys, answers, triaged = false, { act = keys, unsure = false } = {}) {
  const extra = [...(triaged ? [TRIAGED] : []), ...(unsure ? [UNSURE] : [])];
  const ours = new Set([...recipes.map((r) => r.key), UNSURE.key]);
  const m = await messenger.messages.get(id).catch(during("Reading the mail"));
  const { update, folder } = plan(recipes, act, answers);
  const target = folder && m.folder ? await resolveFolder(folder, m.folder.accountId).catch(during("Finding the folder")) : folder;
  const tags = new Set([...m.tags.filter((t) => !ours.has(t)), ...keys, ...extra.map((t) => t.key)]);
  await messenger.messages.update(id, { ...update, tags: [...tags] }).catch(during("Tagging the mail"));
  if (!target || target === m.folder?.id) return;
  await messenger.messages.move([id], target).catch(async (e) => {
    if (triaged) {
      tags.delete(TRIAGED.key);
      await messenger.messages.update(id, { tags: [...tags] }).catch((err) => console.warn("JevIt: removing the Triaged tag failed", err));
    }
    during("Moving the mail")(e);
  });
}

// The step that failed, in front of the error. Halts keep their own message and cause.
const during = (step) => (e) => {
  throw e?.cause === "halt" ? e : new Error(`${step}: ${e?.message ?? e}`, { cause: e?.cause });
};

// Runs fn(id) for a mail from a list. Thunderbird can drop a mail's id while Jev answers (an add-on restart, or the
// header replaced); then the mail is found again by its Message-ID and fn runs once more. Only in the same folder:
// mail moved meanwhile (to Junk by Thunderbird's junk filter, to Trash) is left alone, so a move recipe can't pull
// it back out. That error has cause "gone": nothing went wrong, so triage counts it instead of logging it.
async function onMessage(m, fn) {
  try {
    return await fn(m.id);
  } catch (e) {
    if (!/Message not found/.test(e?.message) || !m.headerMessageId) throw e;
    const { messages } = await messenger.messages.query({ headerMessageId: m.headerMessageId, folderId: m.folder?.id });
    const again = messages.find((x) => x.folder?.id === m.folder?.id);
    if (!again) throw new Error(`${e.message} It was moved or deleted while JevIt worked on it.`, { cause: "gone" });
    m.id = again.id; // the next step uses the new id too
    return fn(m.id);
  }
}

// "light" or "dark": the chosen colour set, or Thunderbird's current theme when set to follow it.
const activeScheme = (settings) =>
  settings.colorScheme === "light" || settings.colorScheme === "dark"
    ? settings.colorScheme
    : globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === false ? "light" : "dark";

// A recipe's tag colour in a scheme. Recipes saved before light colours existed use the default light colour.
const colorFor = (r, scheme) => (scheme === "light" ? r.colorLight ?? defaultColors(r.key)[1] : r.color);

// Create missing JevIt tags and give every JevIt tag its name and colour for the active scheme. Names come from
// the recipes and settings, so a rename in Thunderbird's own tag settings is undone here.
// Thunderbird refuses two tags with one name, so a recipe named like another tag (such as one of your own) gets
// " (JevIt)" added to its tag's name.
async function syncTags(settings) {
  const scheme = activeScheme(settings);
  const triaged = { ...TRIAGED, name: settings.triagedName.trim() || TRIAGED.name, color: settings.triagedColor, colorLight: settings.triagedColorLight };
  const existing = new Map((await messenger.messages.tags.list()).map((t) => [t.key, t]));
  const unsure = { ...UNSURE, name: settings.unsureName.trim() || UNSURE.name };
  for (const r of [...settings.recipes, ...(settings.triagedTag ? [triaged] : []), ...(settings.unsureMargin > 0 ? [unsure] : [])]) {
    const color = colorFor(r, scheme).toUpperCase();
    const taken = [...existing.values()].some((t) => t.key !== r.key && t.tag.toLowerCase() === r.name.toLowerCase());
    const name = taken ? `${r.name} (JevIt)` : r.name;
    const tag = existing.get(r.key);
    if (!tag) await messenger.messages.tags.create(r.key, name, color);
    else if (tag.tag !== name || tag.color?.toUpperCase() !== color) await messenger.messages.tags.update(r.key, { tag: name, color });
    existing.set(r.key, { key: r.key, tag: name, color });
  }
}

// Folder id for a recipe's folder. An every-account folder is looked up by name in the given account
// (top-most match wins) and created at the account's top level if that account doesn't have it yet.
async function resolveFolder(folder, accountId) {
  if (!folder.startsWith(EVERY_ACCOUNT)) return folder;
  return serial(async () => { // parallel mails into a folder that doesn't exist yet must create it once
    const name = folder.slice(EVERY_ACCOUNT.length);
    const found = (await messenger.folders.query({ accountId, name }))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
    if (found) return found.id;
    const [root] = await messenger.folders.query({ accountId, isRoot: true });
    return (await messenger.folders.create(root.id, name)).id;
  });
}

async function* iterate(list) {
  for (;;) {
    yield* list.messages;
    if (!list.id) return;
    list = await messenger.messages.continueList(list.id);
  }
}

if (typeof module !== "undefined") {
  module.exports = { onMessage, markRetry, scoresIn, JEV_API, OPENROUTER_API, localApi, serviceOf, receiver, connectionProblem, storeKey, keySaved, DEFAULTS, RECIPE_LIBRARY, cleanBody, linkHosts, hiddenStyle, stripHidden, updateRecipes, questionFor, questionsFor, reuse, remember, classify, judgedBefore, pruneScores, decide, certainty, dmarcPass, plan, addExample, exampleOf, mergeExamples, learn, saveSettings, draftRecipe, parseBackup, askJev, replyReason, haltRequests, countUsage, resolveFolder, applyRecipes, knownSender, emailState, authServId, trustedServer, addUsage, budgetLeft, monthName, money, syncTags, colorFor, activeScheme, PALETTE };
}
