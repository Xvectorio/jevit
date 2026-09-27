// node test.js  (set TYPESAFE_API_KEY to also run the default recipes against Jev)
const assert = require("node:assert");
const { DEFAULTS, RECIPE_LIBRARY, cleanBody, questionFor, questionsFor, decide, plan, addExample, draftRecipe, parseBackup, askJev } = require("./jev.js");

assert.equal(cleanBody("Hi\n> old quote\n\n\n\n  Bye  "), "Hi\n\nBye");
assert.equal(cleanBody("x".repeat(9000)).length, 6000);

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
assert.equal(junk.color, "#808080");
assert.equal(junk.evil, undefined);
assert.deepEqual(junk.examples, [{ from: "", subject: "", snippet: "s".repeat(300), label: false }]);
assert.throws(() => parseBackup('{"recipes":[{"key":"Bad Key","question":"Q?"}]}'), /Invalid recipe/);
assert.throws(() => parseBackup("{}"), /No recipes/);
assert.throws(() => parseBackup("not json"));
console.log("logic ok");

if (process.env.TYPESAFE_API_KEY) {
  const state = {
    me: "jan@example.com",
    email: {
      from: "Security Team <support@paypa1-verify.com>", to: "jan@example.com", cc: "",
      subject: "Your account is suspended",
      body: "We detected unusual activity. Verify your password within 24 hours at http://paypa1-verify.com or lose access.",
    },
  };
  askJev({ apiKey: process.env.TYPESAFE_API_KEY, model: "jev-latest" }, state, questionsFor(RECIPE_LIBRARY)).then((a) => {
    for (const r of RECIPE_LIBRARY) console.log(r.name.padEnd(18), a[r.key].noul.toFixed(2));
    assert.ok(decide(RECIPE_LIBRARY, a).includes("jev_spam"), "phishing mail should match spam");
    assert.ok(!decide(RECIPE_LIBRARY, a).includes("jev_newsletter"));
    console.log("live ok");
  });
}
