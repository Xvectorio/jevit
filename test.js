// node test.js  (set TYPESAFE_API_KEY to also run the default recipes against Jev)
const assert = require("node:assert");
const { DEFAULTS, RECIPE_LIBRARY, cleanBody, linkHosts, updateRecipes, questionFor, questionsFor, reuse, remember, classify, judgedBefore, pruneScores, decide, certainty, dmarcPass, plan, addExample, draftRecipe, parseBackup, askJev, resolveFolder, applyRecipes, knownSender, emailState, authServId, trustedServer, addUsage, budgetLeft, money, syncTags, colorFor, activeScheme, PALETTE } = require("./jev.js");

assert.equal(cleanBody("Hi\n> old quote\n\n\n\n  Bye  "), "Hi\n\nBye");
assert.equal(cleanBody("x".repeat(9000)).length, 3000);
assert.equal(cleanBody("x".repeat(9000), 500).length, 500);
assert.equal(cleanBody("Deal\u200B\u034F ends: https://t.example.com/c/abc?u=1 (or <https://shop.example/x>)"), "Deal ends: t.example.com (or <shop.example>)");

// Link hosts: one per host, text next to where it really goes; no host, no entry; capped.
assert.deepEqual(linkHosts([
  { href: "https://evil.example/login?id=1", text: " Log in to\n  PayPal " },
  { href: "https://evil.example/other", text: "Unsubscribe" },
  { href: "https://раураl.com/", text: "paypal.com" },
  { href: "/relative", text: "x" }, { href: "mailto:a@b.c", text: "mail" }, { href: "javascript:void(0)", text: "js" }, { href: "http://[bad", text: "bad" },
  { href: "https://cdn.example/i.png", text: "" },
]), ["Log in to PayPal → evil.example", "paypal.com → xn--l-7sba6dbr.com", "→ cdn.example"]);
assert.equal(linkHosts(Array.from({ length: 30 }, (_, i) => ({ href: `https://h${i}.example`, text: "" }))).length, 10);

// Library updates reach saved recipes only where the user kept the old default text.
const saved = [
  { key: "jev_security", no: "Marketing or newsletters that only mention security.", threshold: 0.5, examples: [{ label: true }] },
  { key: "jev_finance", no: "Anything that is not about a specific payment!" },
];
assert.equal(updateRecipes(saved), true);
assert.equal(saved[0].no, RECIPE_LIBRARY.find((r) => r.key === "jev_security").no);
assert.deepEqual([saved[0].threshold, saved[0].examples.length], [0.5, 1], "only the text changes");
assert.equal(saved[1].no, "Anything that is not about a specific payment!", "an edited text is kept");
assert.equal(updateRecipes(saved), false, "nothing left to update");
assert.equal(updateRecipes(structuredClone(DEFAULTS.recipes)), false, "current defaults are up to date");

const keys = RECIPE_LIBRARY.map((r) => r.key);
assert.equal(new Set(keys).size, keys.length, "library keys must be unique");
assert.ok(keys.every((k) => /^[a-z0-9_]+$/.test(k)));

const spam = structuredClone(DEFAULTS.recipes[0]);
assert.equal(questionFor(spam).instructions, spam.question);
const email = { from: "a@b", subject: "Win", body: "Claim your prize" };
for (let i = 0; i < 25; i++) addExample(spam, { ...email, subject: `Win ${i}` }, i % 2 === 0);
assert.equal(spam.examples.length, 20);
assert.deepEqual([spam.examples[0].subject, spam.examples[19].subject], ["Win 5", "Win 24"], "newest 20 kept");
const q = questionFor(spam);
assert.equal(q.instructions.examples_yes.length + q.instructions.examples_no.length, 20);
assert.equal(q.instructions.examples_yes[0].label, undefined);

const rs = DEFAULTS.recipes;
assert.deepEqual(decide(rs, { jev_spam: { noul: 0.8 }, jev_reply: { noul: 0.59 }, jev_urgent: { noul: 0.9 } }), ["jev_spam", "jev_urgent"]);
// Usage: this month's counters restart with a new month; all-time keeps adding. Budget 0 = no limit.
let u = addUsage(null, "2026-09", 2000, 0.042);
u = addUsage(u, "2026-09", 3000, 0.042);
assert.deepEqual([u.requests, u.inputTokens, u.total.requests], [2, 5000, 2]);
assert.ok(Math.abs(u.cost - 0.00021) < 1e-12);
u = addUsage(u, "2026-10", 1000, 0.042);
assert.deepEqual([u.month, u.requests, u.inputTokens, u.total.requests, u.total.inputTokens], ["2026-10", 1, 1000, 3, 6000]);
assert.ok(Math.abs(budgetLeft({ budget: 1 }, u, "2026-10") - (1 - 0.000042)) < 1e-12);
assert.equal(budgetLeft({ budget: 1 }, u, "2026-11"), 1, "a new month starts with the full budget");
assert.equal(budgetLeft({ budget: 0 }, u, "2026-10"), Infinity);
assert.equal(budgetLeft({ budget: 0.0001 }, addUsage(u, "2026-10", 5000, 0.042), "2026-10") <= 0, true);
assert.deepEqual([money(0.00021), money(1.5), money(0)], ["$0.00021", "$1.50", "$0.00"]);

// Known sender: Spam (skipKnown by default) can't match, other recipes still can.
assert.deepEqual(decide(rs, { jev_spam: { noul: 0.99 }, jev_urgent: { noul: 0.9 } }, true), ["jev_urgent"]);
// A sender only counts as known with a DMARC pass for the From address's own domain.
const ar = "mx.google.com; dkim=pass header.i=@corp.nl; spf=pass smtp.mailfrom=corp.nl; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=corp.nl";
assert.equal(dmarcPass(ar, "Boss <Boss@Corp.nl>"), true);
assert.equal(dmarcPass(ar.replace("dmarc=pass", "dmarc=fail"), "Boss <boss@corp.nl>"), false, "DMARC failed");
assert.equal(dmarcPass("mx.example; spf=pass smtp.mailfrom=corp.nl", "boss@corp.nl"), false, "no DMARC result");
assert.equal(dmarcPass(undefined, "boss@corp.nl"), false, "no Authentication-Results header");
assert.equal(dmarcPass(ar, "boss@other.nl"), false, "pass was for another domain");
assert.equal(dmarcPass(ar.replaceAll("corp.nl", "evil.test"), `"<boss@corp.nl>" <x@evil.test>`), true, "the pass is for the real sender x@evil.test, not the display name");
assert.equal(dmarcPass(ar, `"<x@evil.test>" <boss@corp.nl>`), true);
assert.equal(dmarcPass(ar, `"<boss@corp.nl>" <x@evil.test>`), false, "display name can't borrow a contact's DMARC pass");

// Actions: flags merge; only the most probable move wins; a move without a folder is ignored.
const acts = [
  { ...rs[0], action: "junk" },
  { ...rs[1], action: "flag" },
  { ...rs[2], action: "move", folder: "news" },
  { ...rs[3], action: "move", folder: "bills" },
  { ...rs[4], action: "move", folder: "" },
];
const ans = { jev_newsletter: { noul: 0.75 }, jev_finance: { noul: 0.95 }, jev_urgent: { noul: 0.99 } };
assert.deepEqual(plan(acts, ["jev_spam", "jev_reply", "jev_newsletter", "jev_finance", "jev_urgent"], ans),
  { update: { flagged: true, junk: true }, folder: "bills" });
assert.deepEqual(plan(acts, [], ans), { update: {}, folder: null });
const junkmove = [{ ...rs[0], action: "junkmove", folder: "junk" }];
assert.deepEqual(plan(junkmove, ["jev_spam"], {}), { update: { junk: true }, folder: "junk" });
// Certainty: actions wait for actSure; a held-back action or a near miss makes the mail Unsure.
const sure = { actSure: 0.9, unsureMargin: 0.15 };
const junker = [{ ...rs[0], action: "junk" }, { ...rs[1], action: "tag" }]; // Spam 0.8, Needs reply 0.6
assert.deepEqual(certainty(junker, { jev_spam: { noul: 0.95 } }, ["jev_spam"], sure), { act: ["jev_spam"], unsure: false });
assert.deepEqual(certainty(junker, { jev_spam: { noul: 0.85 } }, ["jev_spam"], sure), { act: [], unsure: true }, "tagged, not junked, flagged for review");
assert.deepEqual(certainty(junker, { jev_reply: { noul: 0.61 } }, ["jev_reply"], sure), { act: ["jev_reply"], unsure: false }, "tag-only recipes always act");
assert.equal(certainty(junker, { jev_spam: { noul: 0.7 } }, [], sure).unsure, true, "just under the threshold");
assert.equal(certainty(junker, { jev_spam: { noul: 0.6 } }, [], sure).unsure, false, "well under it");
assert.equal(certainty(junker, { jev_spam: { noul: 0.99 } }, [], sure).unsure, false, "over the threshold but not matched (known sender) isn't unsure");
assert.deepEqual(certainty(junker, { jev_spam: { noul: 0.85 } }, ["jev_spam"]), { act: ["jev_spam"], unsure: false }, "0 = always act, no Unsure tag");
// "More like this" drafts: named after the sender, unique key, the picked mails as yes examples.
const free = { from: "Free Mobile <x@free.fr>", subject: "Nouvelle notification sur votre espace client", body: "Bonjour" };
const d = draftRecipe([free], ["jev_free_mobile"]);
assert.equal(d.name, "Free Mobile");
assert.equal(d.key, "jev_free_mobile_2");
assert.deepEqual(d.examples.map((e) => e.label), [true]);
assert.ok(d.question.includes("`examples_yes`") && d.yes.includes(free.subject));
assert.ok(questionFor(d).instructions.examples_yes.length === 1);
assert.equal(draftRecipe([{ ...free, from: "x@free.fr" }], []).name, "free.fr");
assert.equal(draftRecipe([{ ...free, from: '"Société Générale" <a@sg.fr>' }], []).key, "jev_societe_generale");
// Backup round-trip; the file is untrusted, so junk is cleaned up or rejected.
const backup = JSON.stringify({ app: "JevIt", recipes: [spam, d] });
assert.deepEqual(parseBackup(backup), [spam, d]);
const [junk] = parseBackup(JSON.stringify([{ key: "jev_x", question: "Q?", threshold: 7, action: "rm -rf", color: "red",
  examples: [{ label: "yes" }, { label: false, subject: 1, snippet: "s".repeat(999) }], evil: true }]));
assert.equal(junk.threshold, 0.7);
assert.equal(junk.action, "tag");
assert.equal(junk.color, "#E6E6E6");
assert.equal(junk.evil, undefined);
assert.deepEqual(junk.examples, [{ from: "", subject: "", snippet: "s".repeat(300), label: false }]);
const [big] = parseBackup(JSON.stringify([{ key: "jev_x", question: "Q?", examples: [{ label: true, from: "f".repeat(5000), subject: "s".repeat(5000) }] }]));
assert.deepEqual([big.examples[0].from.length, big.examples[0].subject.length], [1000, 1000], "imported examples are capped");
assert.throws(() => parseBackup('{"recipes":[{"key":"Bad Key","question":"Q?"}]}'), /Invalid recipe/);
assert.throws(() => parseBackup("{}"), /No recipes/);
assert.throws(() => parseBackup("not json"));

// Every-account folders: the mail's own account's folder by name (top-most wins), created there if missing.
const store = [
  { id: "a:/", accountId: "a", path: "/", name: "", isRoot: true },
  { id: "a:/INBOX/Spam", accountId: "a", path: "/INBOX/Spam", name: "Spam" },
  { id: "a:/Spam", accountId: "a", path: "/Spam", name: "Spam" },
  { id: "b:/", accountId: "b", path: "/", name: "", isRoot: true },
];
global.messenger = { folders: {
  query: async (q) => store.filter((f) => Object.entries(q).every(([k, v]) => (f[k] ?? false) === v)),
  create: async (parent, name) => { const f = { id: `${parent}${name}`, accountId: parent[0], path: `/${name}`, name }; store.push(f); return f; },
} };
(async () => {
  assert.equal(await resolveFolder("a:/INBOX", "b"), "a:/INBOX", "a plain folder id is used as is");
  assert.equal(await resolveFolder("*:Spam", "a"), "a:/Spam");
  assert.equal(await resolveFolder("*:Spam", "b"), "b:/Spam", "created in the account that lacks it");
  assert.equal(await resolveFolder("*:Spam", "b"), "b:/Spam", "and found, not re-created, next time");
  assert.equal(store.length, 5);
  const twice = await Promise.all([resolveFolder("*:Later", "a"), resolveFolder("*:Later", "a")]);
  assert.deepEqual([twice, store.length], [["a:/Later", "a:/Later"], 6], "parallel mails create a missing folder once");

  // Triaged tag: added when Jev judged the mail, kept by later teaching; the user's own tags survive.
  const msg = { id: 1, tags: ["$label1", "jev_spam"], folder: { id: "a:/INBOX", accountId: "a" } };
  let updated;
  messenger.messages = {
    get: async () => msg, update: async (id, p) => (updated = p), move: async () => assert.fail("no move expected"),
    tags: { list: async () => assert.fail("applyRecipes must not touch tag definitions") },
  };
  await applyRecipes(1, rs.slice(0, 2), ["jev_reply"], {}, true);
  assert.deepEqual(updated.tags, ["$label1", "jev_reply", "jev_triaged"]);
  msg.tags = updated.tags;
  await applyRecipes(1, [rs[0]], [], {}); // "This is not Spam"
  assert.deepEqual(updated.tags, ["$label1", "jev_reply", "jev_triaged"]);
  // Unsure: triage tags the match but holds its action back; the user's verdict clears the Unsure tag.
  const junkRecipe = [{ ...rs[0], action: "junk" }];
  await applyRecipes(1, junkRecipe, ["jev_spam"], {}, true, { act: [], unsure: true });
  assert.deepEqual([updated.tags, updated.junk], [["$label1", "jev_reply", "jev_triaged", "jev_spam", "jev_unsure"], undefined]);
  msg.tags = updated.tags;
  await applyRecipes(1, junkRecipe, ["jev_spam"], {}); // "This is Spam"
  assert.deepEqual([updated.tags, updated.junk], [["$label1", "jev_reply", "jev_triaged", "jev_spam"], true]);
  msg.tags = ["$label1", "jev_reply", "jev_triaged"];

  // Tag colours: two sets; syncTags creates missing tags and recolours existing ones for the active set.
  assert.deepEqual([rs[0].color, rs[0].colorLight], PALETTE.jev_spam);
  assert.equal(colorFor({ key: "jev_spam", color: "#CC0000" }, "light"), PALETTE.jev_spam[1], "old recipes get the default light colour");
  assert.equal(colorFor({ key: "jev_mine", color: "#123456" }, "light"), "#595959");
  assert.equal(activeScheme({ colorScheme: "light" }), "light");
  assert.equal(activeScheme({ colorScheme: "auto" }), "dark", "no theme info (Node): dark");
  const calls = [];
  messenger.messages.tags = {
    list: async () => [{ key: "jev_spam", tag: "Spam", color: "#FF6B6B" }, { key: "jev_reply", tag: "Needs reply", color: "#A15912" }],
    create: async (...a) => calls.push(["create", ...a]),
    update: async (key, p) => calls.push(["update", key, p.color]),
  };
  const settings = { ...DEFAULTS, recipes: rs.slice(0, 2), colorScheme: "light" };
  await syncTags(settings);
  assert.deepEqual(calls, [["update", "jev_spam", "#D31717"], ["create", "jev_triaged", "Triaged", "#000000"], ["create", "jev_unsure", "Unsure", "#8A5A00"]],
    "reply already right; spam recoloured; triaged and unsure created");
  calls.length = 0;
  await syncTags({ ...settings, colorScheme: "dark", unsureMargin: 0 }); // no Unsure tag when it's turned off
  assert.deepEqual(calls, [["update", "jev_reply", "#FFEBD6"], ["create", "jev_triaged", "Triaged", "#FFFFFF"]]);
  // A recipe named like one of your own tags: Thunderbird refuses a second "Rental", so JevIt's gets a suffix.
  calls.length = 0;
  messenger.messages.tags.list = async () => [{ key: "rental", tag: "Rental", color: "#FF7800" }];
  const rental = { key: "jev_123", name: "Rental", color: "#FF7800", colorLight: "#FF7800" };
  await syncTags({ ...settings, recipes: [rental], unsureMargin: 0 });
  assert.deepEqual(calls[0], ["create", "jev_123", "Rental (JevIt)", "#FF7800"]);
  calls.length = 0;
  await syncTags({ ...settings, recipes: [], unsureMargin: 0, triagedTag: false });
  assert.deepEqual(calls, [], "no Triaged tag created when it's turned off");

  // Known senders: exact address in a contact, or a recipient in Sent; never your own address.
  global.messenger = {
    identities: { list: async () => [{ email: "Me@Example.com" }] },
    contacts: { quickSearch: async ({ searchString }) => [
      { properties: { PrimaryEmail: "friend@x.org", vCard: "BEGIN:VCARD\nEMAIL;PREF=1:Pal@X.org\nEND:VCARD" } },
      { properties: { PrimaryEmail: "aa@b.com" } }, // quick search matches loosely; must not count for a@b.com
    ].filter((c) => JSON.stringify(c).toLowerCase().includes(searchString)) },
    folders: { query: async () => [{ id: "a:/Sent" }] },
    messages: { query: async ({ recipients }) => ({ messages: recipients === "client@corp.nl" ? [{}] : [] }) },
  };
  assert.equal(await knownSender("Friend <FRIEND@x.org>"), true);
  assert.equal(await knownSender("pal@x.org"), true, "email found in vCard text");
  assert.equal(await knownSender("Client <client@corp.nl>"), true, "you sent mail to them");
  assert.equal(await knownSender("a@b.com"), false, "substring of a contact's address is not a match");
  assert.equal(await knownSender("Me <me@example.com>"), false, "own address never counts");
  assert.equal(await knownSender("stranger@spam.biz"), false);
  assert.equal(await knownSender(`"<friend@x.org>" <stranger@spam.biz>`), false, "display name can't pose as a contact");
  assert.equal(await knownSender("<client@corp.nl, stranger@spam.biz>"), false, "no address lists");
  assert.equal(await knownSender("friend@x.org <stranger@spam.biz>"), false);

  // Authentication-Results is only trusted from the server on most of the account's recent Inbox mail.
  assert.equal(authServId("mx.google.com; dkim=pass header.i=@x.com"), "mx.google.com");
  assert.equal(authServId("MX.Example.COM 1; spf=pass"), "mx.example.com", "optional version number");
  assert.equal(authServId("spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=x.com; dmarc=pass header.from=x.com"), "", "Microsoft: no authserv-id");
  const inboxWith = (headers) => {
    const store = {};
    global.messenger = {
      storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
      folders: { query: async () => [{ id: "a:/INBOX" }] },
      messages: {
        query: async () => ({ messages: headers.map((h, id) => ({ id })) }),
        getFull: async (id) => ({ headers: headers[id] === null ? {} : { "authentication-results": [headers[id]] } }),
      },
    };
    return store;
  };
  const g = "mx.google.com; dmarc=pass header.from=x.com";
  const cache = inboxWith([...Array(8).fill(g), "evil.test; dmarc=pass", null, null]);
  assert.equal(await trustedServer("a"), "mx.google.com");
  assert.equal(cache.authServers.a.id, "mx.google.com", "cached");
  cache.authServers.a.id = "cached.example";
  assert.equal(await trustedServer("a"), "cached.example", "cache used within a week");
  inboxWith([g, g, g, "evil.test; dmarc=pass", "evil.test; dmarc=pass"]);
  assert.equal(await trustedServer("a"), "mx.google.com", "3 of 5 is a majority");
  inboxWith([g, g]);
  assert.equal(await trustedServer("a"), null, "fewer than 3 mails: not enough to trust");
  inboxWith([...Array(6).fill(null), ...Array(5).fill("evil.test; dmarc=pass")]);
  assert.equal(await trustedServer("a"), null, "server adds no header: the most common is 'none', nothing trusted");
  inboxWith(Array(6).fill("spf=pass; dmarc=pass header.from=x.com"));
  assert.equal(await trustedServer("a"), "", "Microsoft's nameless header can be the trusted one");

  // A sender can't inflate the request: sender, subject and each address are capped, and To/Cc to 20 addresses.
  global.messenger = {
    messages: {
      get: async () => ({ author: "a".repeat(5000), subject: "s".repeat(5000), recipients: Array(5000).fill("x".repeat(2000)), ccList: undefined }),
      listInlineTextParts: async () => [{ contentType: "text/plain", content: "Hi" }],
      listAttachments: async () => Array(50).fill({ name: "n".repeat(5000), contentType: "application/pdf" }),
      getFull: async () => ({ headers: { "reply-to": ["r".repeat(5000)] } }),
    },
  };
  const big = (await emailState(1, 3000)).email;
  assert.deepEqual([big.from.length, big.subject.length, big.to.length, big.to[0].length, big.cc], [1000, 1000, 20, 1000, []]);
  assert.deepEqual([big.attachments.length, big.attachments[0].length, big.headers["Reply-To"].length, big.links], [10, 200, 1000, []]);

  // Stored scores: asking again is free; only recipes whose question changed (edited, taught) go to Jev again.
  const local = { consent: true, budget: 1 };
  let body = "Claim your prize", asked = [];
  global.fetch = async (url, { body: req }) => {
    const { questions } = JSON.parse(req);
    asked.push(Object.keys(questions));
    return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(questions).map((k) => [k, { noul: 0.95 }])), usage: { input_tokens: 1000 } }) };
  };
  global.messenger = {
    storage: { local: {
      get: async (k) => (typeof k === "string" ? { [k]: local[k] } : Object.fromEntries(Object.entries(k).map(([key, d]) => [key, local[key] ?? d]))),
      set: async (o) => Object.assign(local, o),
    } },
    messages: {
      get: async () => ({ author: "x@spam.biz", subject: "Win", recipients: [], ccList: [] }),
      listInlineTextParts: async () => [{ contentType: "text/plain", content: body }],
      listAttachments: async () => [],
      getFull: async () => ({ headers: {} }),
    },
  };
  const s2 = { ...DEFAULTS, apiKey: "k", recipes: structuredClone(rs.slice(0, 2)) };
  const first = await classify(1, s2);
  assert.deepEqual([asked, first.keys, local.usage.requests], [[["jev_spam", "jev_reply"]], ["jev_spam", "jev_reply"], 1]);
  const again = await classify(1, s2);
  assert.deepEqual([asked.length, again.answers, local.usage.requests], [1, first.answers, 1], "second time: stored scores, no request");
  addExample(s2.recipes[0], email, true);
  await classify(1, s2);
  assert.deepEqual(asked[1], ["jev_spam"], "a taught recipe is asked again, the other reused");
  local.budget = 0.00001;
  assert.deepEqual((await classify(1, s2)).keys, ["jev_spam", "jev_reply"], "stored scores still work when the budget is used up");
  body = "Claim your prize now";
  await assert.rejects(classify(1, s2), /budget/, "a changed email can't use another's scores");
  assert.equal(Object.keys(local).filter((k) => k.startsWith("score:")).length, 1);
  const [scored] = Object.keys(local).filter((k) => k.startsWith("score:"));
  assert.ok(Date.now() - local[scored].at < 1000, "stored with the time Jev was asked");
  assert.equal(await judgedBefore(1, s2.bodyChars), false, "changed email: not judged before");
  body = "Claim your prize";
  assert.equal(await judgedBefore(1, s2.bodyChars), true, "stored scores mark mail as judged, without the Triaged tag");
  Object.assign(local, { "score:old": { at: Date.now() - 91 * 864e5, x: 1 }, "score:notime": { x: 1 } });
  messenger.storage.local.get = async (k) => (k === null ? { ...local } : assert.fail("get(null) only"));
  messenger.storage.local.remove = async (keys) => keys.forEach((k) => delete local[k]);
  await pruneScores();
  assert.deepEqual(Object.keys(local).filter((k) => k.startsWith("score:")), [scored], "old and undated scores removed, recent kept");
  assert.deepEqual(reuse(rs.slice(0, 2), ["a", "b"], { b: 0.4, c: 1 }), { answers: { jev_reply: { noul: 0.4 } }, missing: [rs[0]] });
  assert.deepEqual(remember(rs.slice(0, 2), ["a", "b"], { jev_spam: { noul: 0.9 } }), { a: 0.9 }, "only recipes with an answer");
  console.log("logic ok");
})();

if (process.env.TYPESAFE_API_KEY) {
  const state = {
    me: "jan@example.com",
    email: {
      from: "Security Team <support@paypa1-verify.com>", to: "jan@example.com", cc: "",
      subject: "Your account is suspended",
      body: "We detected unusual activity. Verify your password within 24 hours at http://paypa1-verify.com or lose access.",
    },
  };
  askJev({ apiKey: process.env.TYPESAFE_API_KEY, model: "jev-latest" }, state, questionsFor(RECIPE_LIBRARY)).then(({ answers: a, usage }) => {
    console.log("usage", usage);
    for (const r of RECIPE_LIBRARY) console.log(r.name.padEnd(18), a[r.key].noul.toFixed(2));
    assert.ok(decide(RECIPE_LIBRARY, a).includes("jev_spam"), "phishing mail should match spam");
    assert.ok(!decide(RECIPE_LIBRARY, a).includes("jev_newsletter"));
    console.log("live ok");
  });
}
