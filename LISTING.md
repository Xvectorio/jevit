# JevIt: ATN listing texts

Paste these into the fields at https://addons.thunderbird.net/developers/ when submitting `jevit.xpi`.

## Name
JevIt: AI mail triage

## Summary (≤ 250 characters)
Triage your mail with TypeSafe's Jev model: recipes tag, star, mark read, junk or move mail. Tune them, teach Jev from your corrections, and back them up. Uses your own TypeSafe API key. Unofficial; not affiliated with TypeSafe.

## Description
JevIt sorts your mail with **recipes**. A recipe is one plain-language yes/no question, such as "Is this an invoice or receipt?", which TypeSafe's Jev model answers for each email with a probability. When the probability reaches the recipe's threshold, JevIt tags the email and can also star it, mark it read, mark it as junk, or move it to a folder.

**Features**
- Ready-made recipes: Spam, Needs reply, Newsletter, Invoice / receipt, Urgent, Meeting / event, Shipping, Security alert, Personal, Social, Jobs / recruiting.
- Write your own recipes, or create one from selected mail ("more like this").
- Teach Jev: right-click mail → JevIt → "This is …" / "This is not …". The mail becomes an example the recipe learns from. Shortcuts: Alt+Shift+S (spam) and Alt+Shift+D (not spam).
- Review Jev's scores for the open email in the header popup, then correct and apply them.
- Triage selected mail from the context menu, or turn on automatic triage for new mail. Already triaged mail is skipped by default. The toolbar button counts the mails done, and a click stops a long run.
- A Triaged tag on every mail Jev has judged, and tag colours for both light and dark themes.
- Move matches to one folder, or to a folder of the same name in each account (such as each account's own Junk).
- Exclude accounts: mail in an excluded account is never sent to Jev.
- Export and import recipes as a JSON backup.
- Usage and budget: see requests, tokens and estimated cost per month, and set a monthly spending limit (default $1).
- Spam protection for people you know: mail from your contacts, or from people you've sent mail to, is never tagged as Spam, when your mail server's DMARC check confirms the sender (a per-recipe option). It's checked locally.

**Requirements**
- A TypeSafe API key (https://typesafe.ai). Usage is billed to your TypeSafe account by TypeSafe.
- Thunderbird 128 or newer.

**Privacy.** Nothing is sent until you explicitly allow it in the JevIt manager. Mail content goes only to TypeSafe, never to the JevIt author. See the privacy policy for details.

JevIt is an independent project and is not affiliated with or endorsed by TypeSafe. "Jev" is TypeSafe's model name.

## Categories
Tags; Filters

## Support
Email: jevit@xvector.io

## License
Mozilla Public License 2.0 (MPL-2.0)

## Privacy policy
**JevIt privacy policy**

JevIt is a Thunderbird add-on that classifies email with TypeSafe's Jev model. This policy describes what data the add-on handles.

**What is sent, and to whom.** Only after you tick "JevIt may send the content of emails I triage to TypeSafe" in the JevIt manager, JevIt sends the following to TypeSafe (https://api.typesafe.ai) over an encrypted HTTPS connection, for each email you triage:
- the email's sender, recipients (To and CC), subject, and text body. Quoted replies, styling and link paths are removed, and the body is limited to 3000 characters (adjustable in the manager).
- two of the email's headers: Authentication-Results (your mail server's SPF, DKIM and DMARC verdict, which helps spot forged senders) and List-Unsubscribe (which helps spot bulk mail).
- the email address of your account's default identity, so recipes can tell whether mail is addressed to you.
- your recipes: their questions and descriptions, and their learned examples (sender, subject and the first 300 characters of example emails you marked).

Triage happens only for new mail if you turned on automatic triage, or for mail you select or open and triage yourself. Mail in accounts you exclude in the manager is never sent. The request is authenticated with your own TypeSafe API key. TypeSafe processes this data under its own terms and privacy policy (https://docs.typesafe.ai/legal). According to TypeSafe, requests are not used to train its models.

**Known senders.** For recipes set to "Never match mail from people I know" (Spam by default), JevIt checks locally whether the sender is in one of your local address books, or is a recipient of mail in your Sent folders. This only counts when the Authentication-Results header from your mail server shows a DMARC pass for the sender's domain, so a faked sender address isn't trusted. To know which Authentication-Results header is your mail server's, JevIt reads that header on up to 5 recent Inbox mails per account, weekly. It needs Thunderbird's address book permission for this. The lookup happens inside Thunderbird, and your contacts and sent mail are never sent to TypeSafe or anyone else.

**What stays on your computer.** Your API key, your recipes and learned examples, your usage counters (requests, tokens, estimated cost) and your settings are stored only in Thunderbird's local extension storage. Exported backups are files you save yourself. They contain recipes and examples, but not your API key.

**What the author receives.** Nothing. JevIt has no analytics, telemetry, tracking or server of its own, and it sends no data to the author or to anyone other than TypeSafe.

**Your control.** Untick the consent box to stop all requests immediately. Remove recipes or examples in the manager, or uninstall JevIt to delete all its stored data. Tags JevIt added to your mail remain until you remove them.

**Contact.** jevit@xvector.io

## Notes to reviewer
- There's no build step. The package is the readable source, and nothing is minified or loaded remotely.
- To test triage you need a TypeSafe API key. Test key (limited budget, for review only): paste the contents of `reviewer-key.txt` (kept out of git).
- Test steps:
  1. After install, the manager opens. Tick the consent box, paste the key and click Save.
  2. Open an email and click the JevIt button in the message header to see Jev's scores.
  3. Or right-click mail → JevIt → Triage with Jev.
- The `sensitiveDataUpload` permission is declared because email content is sent to TypeSafe for classification, which is the add-on's core function. It needs opt-in consent first.

## Screenshots to add
1. The recipe manager, including the consent box.
2. The message-header popup with Jev's scores.
3. The right-click menu: JevIt → recipe → "This is …".
