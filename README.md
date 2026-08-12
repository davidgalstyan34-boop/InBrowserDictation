# In-Browser Dictation

Chrome extension for shortcut-driven dictation. The current build contains the Manifest V3 runtime, service worker, content script handshake, keyboard command, options storage, shared state/message contracts, and offscreen microphone recording.

## Current Capability

Current goal:

```text
Shortcut -> record -> stop -> obtain audio blob.
```

STT, LLM rewriting, insertion, and clipboard fallback are upcoming milestones. See [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 24 or newer is known to work.
- Chrome or a Chromium browser with unpacked extensions enabled.

No npm packages are required for the current build.

## Commands

```bash
npm test
npm run build
```

If PowerShell blocks the `npm.ps1` shim, run `npm.cmd test` and `npm.cmd run build` instead.

`npm run build` copies `src/` into `dist/` and validates the required extension files.

## Load Unpacked Extension

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `dist` directory.

## Configure

Open the extension options page and save:

- Deepgram API key for STT.
- OpenAI API key for LLM rewriting.
- Default rewrite style.

Keys are stored with `chrome.storage.sync` for this take-home implementation. A production version should protect provider credentials behind a backend or authenticated service.

## Usage

The default command is `Ctrl+Shift+Space` on Windows/Linux and `Command+Shift+Space` on macOS. Chrome may require you to confirm or change this shortcut at `chrome://extensions/shortcuts`.

Pressing the shortcut on a normal webpage displays a small overlay, captures a summary of the current editable target, and starts microphone recording through an offscreen document. Pressing it again stops recording, releases microphone tracks, and reports the captured audio metadata. Chrome prompts for microphone permission the first time recording starts.

On first use, Chrome may open a small extension window to request microphone access. Allow access there; the window releases the test stream immediately and recording continues from the original page.

## Privacy Notes

The final product will send microphone audio to the configured STT provider and transcript text to the configured LLM provider. The current build captures microphone audio locally inside the extension and does not make provider network requests.

## Known Limitations

- No provider calls yet.
- No text insertion yet.
- Content scripts cannot run on restricted Chrome pages such as `chrome://extensions`.

## Troubleshooting

If the service worker logs `CONTENT_MODULE_LOAD_FAILED` or `Failed to fetch dynamically imported module`, rebuild, reload the extension, then refresh the target webpage. Existing tabs can retain old content-script instances after an unpacked extension reload.

If the service worker logs `Receiving end does not exist`, the active tab did not have the content script loaded. The command path now retries by injecting the content script into the active tab; this still cannot work on restricted pages such as `chrome://` URLs.

If the service worker logs `MICROPHONE_PERMISSION_DENIED`, use the microphone permission window opened by the extension. If you denied access previously, reset the extension's microphone permission in Chrome site settings for the `chrome-extension://` origin or reload the unpacked extension and try again.
