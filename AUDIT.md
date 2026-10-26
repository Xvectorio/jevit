# Review record

This is a review record of one commit, not a certification and not a trust seal. The reading was done with AI assistance for the GitHub account [antgraf](https://github.com/antgraf). That account is not the add-on author. It covers commit `5735d3551ecac00f8c24d2a9a52f16bf9aa778c2` on `main`, dated 2026-10-23 (add-on version 1.1.2). Thunderbird was not run. The live TypeSafe call was not made. Open pull request [#4](https://github.com/Xvectorio/jevit/pull/4) is not covered. A row below is a claim about that commit, not a guarantee about a later one.

## Privacy

Sending a defined subset of a message to TypeSafe, after consent, is what this commit does. Nothing in the tree is sent to the add-on author. There is no analytics call. This reading did not check TypeSafe's servers, or the listing's statement that requests are not used to train models.

The only network client is `askJev` in `jev.js`. It POSTs `{ model, state, questions }` to `settings.endpoint`, default `https://api.typesafe.ai/v1/systemone`, with `Authorization: Bearer` and the user's TypeSafe API key. `redirect: "error"` makes a redirect fail instead of forwarding the body and the key. The manifest allows that POST to `https://api.typesafe.ai/*` and to `http://127.0.0.1/*`.

`emailState` in `jev.js` builds `state`. `classify` sends it only when at least one recipe has no stored score and the monthly budget still allows a request. A fully cached message makes no request. Consent defaults to false. Automatic triage defaults to false and runs only when that checkbox is on.

On a request, the payload is:

- The API key, as the bearer header, including each retry, and the model name.
- The account's default identity address (`me`).
- The sender string, display name included, up to 1000 characters.
- To and Cc, 20 addresses each, 1000 characters each. Bcc is not read.
- The subject, up to 1000 characters.
- The body after `cleanBody`, 3000 characters by default.
- Up to 10 link entries from the HTML part: 80 characters of link text plus the hostname. The link is not opened. Attachment bytes are not copied. Up to 10 attachment names and content types are included, 200 characters each. An attached message is listed and not walked into.
- The first `Authentication-Results`, `List-Unsubscribe`, and `Reply-To` value, 1000 characters each, copied raw. They are not passed through `cleanBody`, so a URL in those headers is not reduced to a host.
- The question, yes-text, no-text, and learned examples of each recipe that still needs a score. Examples are the sender, the subject, and a 300-character snippet, without the label, at most 20 per recipe.

The full MIME is read locally by `messages.getFull` and is not what is uploaded. A one-time code written in the message text is part of the body, so it is included in that cap. Contacts, Sent mail, and the known-sender result stay on the machine. The address-book search sets `includeRemote: false`.

The callers that reach `classify` are selected-mail triage, automatic triage, and the header popup (it classifies when it opens, before Apply). Mail in an account listed in `excludedAccounts` is not passed to `classify` from those callers. `teach` and `newRecipeFrom` do not call `askJev`. They store examples or a draft locally. Those snippets are uploaded only on a later consented classification.

A recipe action of move, or junk and move, can also send the whole message, including attachment bytes, by another path. `applyRecipes` calls `messages.move` to the folder id stored on the recipe. The destination is the folder the user saved, not a value taken from the message. Help states that a folder in another account makes Thunderbird copy the message.

Scores kept in `storage.local` are probabilities and a timestamp. The storage key is 16 bytes of SHA-256 of the email state, and of the endpoint URL when it is not the TypeSafe default. The message is not recoverable from the entry. The privacy policy says they are removed after 90 days. `pruneScores` runs when the background page loads, and `judgedBefore` does not read the timestamp, so an entry can outlive that ([#14](https://github.com/Xvectorio/jevit/issues/14)).

`cleanBody` does not always reduce a URL to its host, so some URL material remains in the body that is uploaded ([#5](https://github.com/Xvectorio/jevit/issues/5)). `htmlText` removes four tags and then reads `textContent`, so text hidden with CSS is still taken, and `emailState` collects every HTML anchor ([#6](https://github.com/Xvectorio/jevit/issues/6)). The text-limit hint says that 0 sends no text. Links, attachment names, and the account address are still set. Other sentences in the manager, help, README, and LISTING disagree with the code on skip, on when star, junk, and move run, and on teaching an excluded account ([#13](https://github.com/Xvectorio/jevit/issues/13)).

Unticking consent, clicking stop, or exhausting the budget does not cancel a POST that has already started, and several workers can pass the budget check before any of them records the cost ([#9](https://github.com/Xvectorio/jevit/issues/9)). A failed classification stores the message subject and can show the server's response in a desktop notification ([#8](https://github.com/Xvectorio/jevit/issues/8)).

## Security

The exposures above are the unintentional ones found in this commit. `cleanBody` can leave URL userinfo, a query or fragment on a URL with no path, or a `mailto` query in `email.body`, which is then uploaded ([#5](https://github.com/Xvectorio/jevit/issues/5)). Text and link hosts the reader does not see can be uploaded and can change that message's score ([#6](https://github.com/Xvectorio/jevit/issues/6)).

The TypeSafe key is stored in `storage.local` from the password field. Taught snippets and the draft for "New recipe from selected mail…" are stored there too. The add-on does not encrypt them and does not put the key in the login manager. Anyone who can read the profile can use the key and can read that mail text. Thunderbird's primary password covers saved logins, not this storage. Other extensions cannot read it ([#7](https://github.com/Xvectorio/jevit/issues/7)). Subjects of failed messages, and the server's response text, stay in the same store and can appear in an operating-system notification ([#8](https://github.com/Xvectorio/jevit/issues/8)).

A triage that is already past the consent check finishes that upload if consent is turned off, the toolbar stop is clicked, or the budget runs out during the request. `askJev` has no abort signal and no timeout ([#9](https://github.com/Xvectorio/jevit/issues/9)).

`askJev` posts to `settings.endpoint` whenever that value is set. The default is the TypeSafe URL over HTTPS. The manager in this commit has no field for it, and `read` in `options.js` never assigns it, so a Save keeps whatever was already stored. The manifest's loopback permission is `http://127.0.0.1/*`. If a loopback URL is already stored, the key and the payload go to that local process in cleartext. Nothing in this commit's UI, backup import, or `parseBackup` sets `endpoint`. Writing it takes the same profile access that can already read the key. Choosing TypeSafe, OpenRouter, or a local Open-Jev is the open work in [#3](https://github.com/Xvectorio/jevit/issues/3) and [#4](https://github.com/Xvectorio/jevit/pull/4). This record does not cover that pull request and does not open a second issue for it.

A message cannot choose the endpoint, read the API key, or cause a different message to be uploaded or moved. The model response is used as a number and an input-token count. It is not executed. There is no content script and no external message listener. Extension pages are not web-accessible.

The same reading filed these further defects. A failed move, or a response with no numeric scores, is stored as judged, and the default skip does not retry it ([#10](https://github.com/Xvectorio/jevit/issues/10)). `teach` and popup Apply replace the whole recipe list, so a later failure or an overlapping Save can drop examples after mail has already been changed ([#11](https://github.com/Xvectorio/jevit/issues/11)). Two recipe writes close together can wipe or duplicate the context menu ([#12](https://github.com/Xvectorio/jevit/issues/12)). The trusted authserv-id is cached for seven days from an Inbox query that does not ask for the five newest messages ([#15](https://github.com/Xvectorio/jevit/issues/15)). The Spam shortcuts and the known-sender switch stay on the tag key `jev_spam` if that key is renamed ([#16](https://github.com/Xvectorio/jevit/issues/16)). The sentences that disagree with the code are [#13](https://github.com/Xvectorio/jevit/issues/13), and the 90-day score retention is [#14](https://github.com/Xvectorio/jevit/issues/14).

## Legal

This is a reading of the MPL 2.0 text in this repo. It is not legal advice.

`LICENSE` is the Mozilla Public License, version 2.0. `README.md` points at that file. `LISTING.md` names MPL-2.0. The README zip command includes `LICENSE` in the xpi. No source file carries its own copyright line, SPDX identifier, or Exhibit A header. Exhibit A says the notice may live in a `LICENSE` file in a relevant directory. That is the placement this commit uses. No contributor agreement, contributing guide, or developer certificate of origin was found. No second license, `NOTICE` file, or vendored library was found.

The license allows a fork, changes, and an independent publication. Section 2.1 grants a world-wide, royalty-free, non-exclusive license to use, reproduce, modify, distribute, and otherwise exploit the contribution, unmodified, with modifications, or as part of a larger work, and a patent license limited as sections 2.3 and 5.2 describe. Changes do not have to be sent back upstream.

Distribution has conditions. Covered source, including modifications, stays under this license, and recipients must be told that the source is under the MPL and how to obtain a copy of it (sections 3.1 and 2.7). An xpi is an executable form. Shipping one requires the source of the covered files to be made available as in section 3.1, at no more than the cost of distribution, and recipients must be told how to get it (section 3.2). The README zip is readable source plus `LICENSE`, the icons, and the HTML, CSS, and JS. It leaves out `test.js`, `README.md`, `LISTING.md`, and `screenshots/`. An independent xpi is still an executable form, so that source obligation still applies. The substance of the license notices in `LICENSE`, including the warranty disclaimer and the liability limitation, is not to be removed (section 3.4).

The copyleft is file-level. A changed covered file, and a new file that contains covered code, stay under the MPL (sections 1.10 and 3.1). Separate files that do not contain covered code may sit beside it under other terms, as a Larger Work (sections 1.7 and 3.3).

The license grants no trademark, service-mark, or logo rights in any contributor's marks, except as needed to keep the section 3.4 notices (section 2.3). This commit does not name a trademark registration and has no separate trademark policy. The name it attributes to someone else is "Jev". The listing says "Jev" is TypeSafe's model name, and that JevIt is an independent project and is not affiliated with or endorsed by TypeSafe. The same unaffiliated statement is in the README, the manifest description, the manager, and help. Those are product sentences. The license text speaks only to contributor marks.

Section 10.2 allows distribution under this version of the MPL or a later version published by the Mozilla Foundation. That is not a right to drop the MPL from this code. Exhibit B is part of the license document and is not attached to a source file.

To add a finding, or to dispute one, open an issue, or a pull request that changes this file. Name the commit and the file you read. A row in this file is a claim about that commit, not a guarantee about later commits.
