# JevIt: AI mail triage

A Thunderbird add-on that sorts your mail with **recipes**: plain-language yes/no questions ("Is this an invoice or receipt?") that TypeSafe's Jev model answers for each email. When a recipe's answer passes its threshold, JevIt tags the mail and can also star it, mark it read, mark it as junk, or move it to a folder.

Unofficial; not affiliated with TypeSafe.

**Install:** [JevIt on addons.thunderbird.net](https://addons.thunderbird.net/addon/jevit-ai-mail-triage/), or in Thunderbird search for "JevIt" under Add-ons and Themes.

| Connection, usage and budget | Recipes |
|---|---|
| ![JevIt manager: connection, usage and budget](screenshots/manager.png) | ![JevIt manager: recipes](screenshots/recipes.png) |

## Features

- Ready-made recipes: Spam, Needs reply, Newsletter, Invoice / receipt, Urgent, Meeting / event, Shipping, Security alert, Phishing, Personal, Social, Jobs / recruiting.
- Write your own recipes, or create one from selected mail ("more like this").
- Teach Jev from your corrections: right-click → JevIt → "This is …" / "This is not …". Shortcuts: Alt+Shift+S (spam), Alt+Shift+D (not spam).
- See Jev's scores for the open email in the message-header popup, then correct and apply them.
- Triage selected mail from the context menu, or automatically for new mail. Already triaged mail is skipped by default.
- Progress on the toolbar button while triaging. Click the button to stop a long run. When a manual run is done, one notification sums up what each recipe matched.
- A Triaged tag on every mail Jev has judged (optional), and tag colours for both light and dark themes.
- Careful with uncertain mail: star, mark read, junk and move only happen when Jev is at least 90% sure. Below that, and for near misses, mail gets an Unsure tag to review and teach Jev from.
- Move matches to one folder, or to a folder of the same name in each account (such as each account's own Junk).
- Jev sees where links really go (the host name behind each link text), which helps the Spam and Phishing recipes. Links are never opened.
- Mail from your contacts, or from people you've written to, is never tagged as Spam, when your mail server's DMARC check confirms the sender. This is checked locally.
- Exclude accounts: mail in them is never sent to Jev.
- Jev's scores are remembered locally: the header popup, and triaging mail again after changing a threshold, cost nothing. Only edited or taught recipes are asked again.
- Usage and a monthly budget (default $1) so costs stay in check.
- Export and import recipes as a JSON backup.

## Requirements

- Thunderbird 128 or newer
- A TypeSafe API key from https://typesafe.ai, or an OpenRouter API key from https://openrouter.ai

Nothing is sent until you allow it in the JevIt manager and save the connection. Mail content goes to your configured API service; OpenRouter forwards it to TypeSafe. See the privacy policy in [LISTING.md](LISTING.md).

## Connect through OpenRouter

In the JevIt manager, configure **Connection**:

1. Set **API base URL** to `https://openrouter.ai/api`.
2. Read the data-sharing notice and tick consent for the configured API service.
3. Enter your OpenRouter key in **API key**.
4. Set **Model** to `jev-latest` or `typesafe/jev-1.13`.
5. Click **Save** and allow access to `openrouter.ai` when Thunderbird asks.

JevIt appends `/v1/systemone` to the base URL. OpenRouter supports the same
request and response format as TypeSafe; see its [System One API documentation](https://openrouter.ai/docs/guides/community/typesafe-sdk).
Use `https://openrouter.ai/api`, without `/v1`. This connection uses Jev's
decision model, not `typesafe/jev-router` or the chat completions API.

To use TypeSafe directly, set the base to `https://api.typesafe.ai` (the default).
Other custom bases must use HTTPS and implement the System One API.
Changing the base clears the key and consent in the form. Enter the key for the
new service and save again. The saved connection remains active until you save;
untick consent before editing the base if you want to stop new requests first.

Scores are cached separately for each base URL. To classify previously tagged
mail through the new service, untick **Skip already triaged mail**.
Usage counters and the monthly budget remain shared across services; set the
input-token price to match your provider. Costs are estimates.

## Download a GitHub build

The **Build extension** GitHub Actions workflow packages the extension on pushes
and pull requests. It also supports **Run workflow** once the workflow is on the
repository's default branch. It does not run tests or make API calls.

1. Open the repository's **Actions** tab and select a successful **Build extension** run.
2. Download the **jevit-xpi** artifact and extract `jevit-VERSION.xpi` from it.
   `VERSION` is the version in `manifest.json`.
3. In Thunderbird, open **Add-ons and Themes → gear → Install Add-on From File**
   and select the `.xpi` file.

The artifact is retained for 30 days. The workflow packages only the extension's
runtime files and license; it does not publish a release or submit the add-on to
addons.thunderbird.net.

## Development

There's no build step. To try it, go to Add-ons → gear → Debug Add-ons → Load Temporary Add-on and pick `manifest.json`.

```sh
node test.js      # logic tests; set TYPESAFE_API_KEY to also run the default recipes against Jev
zip jevit.xpi manifest.json LICENSE icon-*.png jev.js background.js popup.* options.* help.html style.css
```

## Support

JevIt is free. If it saves you time, you can buy me a coffee at [ko-fi.com/jevit](https://ko-fi.com/jevit).

## License

[MPL-2.0](LICENSE)
