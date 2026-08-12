# In-Browser Dictation

Chrome extension for shortcut-driven dictation. Phase 1 contains the Manifest V3 skeleton, service worker, content script handshake, keyboard command, options storage, and shared state/message contracts.

## Current Phase

Phase 1 goal:

```text
Shortcut reliably reaches the extension architecture.
```

Recording, STT, LLM rewriting, insertion, and clipboard fallback are planned in later phases. See [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 24 or newer is known to work.
- Chrome or a Chromium browser with unpacked extensions enabled.

No npm packages are required in Phase 1.

## Commands

```bash
npm test
npm run build
```

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

In Phase 1, pressing the shortcut on a normal webpage displays a small overlay and captures a summary of the current editable target. Pressing it again cancels the placeholder session. Audio recording starts in Phase 2.

## Privacy Notes

The final product will send microphone audio to the configured STT provider and transcript text to the configured LLM provider. Phase 1 does not make provider network requests.

## Known Limitations

- No audio recording yet.
- No provider calls yet.
- No text insertion yet.
- Content scripts cannot run on restricted Chrome pages such as `chrome://extensions`.
