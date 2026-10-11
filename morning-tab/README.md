# The Morning Tab

A Chrome extension that replaces your new-tab page with a daily newspaper front page written by Claude from the sites you read.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `morning-tab` folder.
2. Open the extension's **Settings** (or the link on the new tab) and paste your Anthropic API key.
3. Open a new tab. The first tab each day generates the edition (~10–20s); it is cached for the rest of the day. **Regenerate** forces a new one.

## How it works
- Reads the last N days of Chrome history (default 7) and ranks your top sites.
- Fetches the front pages of your top 8 sites and extracts headlines.
- Sends titles/headlines to the Anthropic Messages API and renders the returned JSON edition.

## Privacy
Your key is stored in `chrome.storage.local` and sent only to `api.anthropic.com`. Page titles and headlines from your most-visited sites are included in the prompt. Stories link only to URLs supplied in the prompt.
