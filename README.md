# In-Browser Dictation

Chrome extension for shortcut-driven dictation. The current build contains the Manifest V3 runtime, service worker, content script handshake, keyboard command, options storage, shared state/message contracts, offscreen microphone recording, Deepgram speech-to-text, Gemini text improvement, target insertion, clipboard fallback, custom rewrite styles, a toolbar popup, latest-result recovery, and retry rewrite.

## Current Capability

Current goal:

```text
Shortcut -> record -> stop -> send audio to Deepgram -> improve transcript with Gemini -> insert into the captured target or copy to clipboard.
```

Phase 7 product differentiation is now included: custom reusable styles, latest-result recovery, popup controls, retry rewrite, and stronger contenteditable insertion. See [docs/architecture.md](docs/architecture.md).

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
- Gemini API key for LLM rewriting.
- Default rewrite style.
- Optional custom rewrite styles.

The Gemini key is optional when the selected style is Raw because that path skips text improvement.

Keys are stored with `chrome.storage.sync` for this take-home implementation. A production version should protect provider credentials behind a backend or authenticated service.

## Usage

The default command is `Ctrl+Shift+Space` on Windows/Linux and `Command+Shift+Space` on macOS. Chrome may require you to confirm or change this shortcut at `chrome://extensions/shortcuts`.

Pressing the shortcut on a normal webpage displays a small overlay, captures the current editable target, and starts microphone recording through an offscreen document. Pressing it again stops recording, releases microphone tracks, sends the captured audio to Deepgram, sends the transcript to Gemini for the selected rewrite style, and inserts the final text into the originally captured target. Chrome prompts for microphone permission the first time recording starts.

Editors inside iframes (mail compose windows, many embedded rich editors) and inside web components are supported: the frame holding the focused element captures and receives the text, while the status overlay stays in the top-level page.

Recording stops automatically after five minutes and transcribes what it captured, so a forgotten session cannot hold the microphone open indefinitely.

Password and hidden fields are never dictation targets. Focusing one and pressing the shortcut fails immediately without recording, so no audio is sent to a provider and no text reaches the clipboard.

If the captured target is gone, stale, or no editable target was focused, the extension copies the final text to the clipboard when Chrome allows it. If both insertion and the clipboard fail, the text is still recoverable from the popup, and the page overlay says so. If the selected style is Raw, the extension skips the Gemini call and inserts or copies the Deepgram transcript unchanged. If Gemini text improvement fails after STT succeeds, the session inserts or copies the raw transcript and shows a warning instead of failing the dictation.

On first use, Chrome may open a small extension window to request microphone access. Allow access there; the window releases the test stream immediately and recording continues from the original page.

The toolbar popup is optional. It shows current status, selected style, Chrome's active shortcut assignment, and the latest successful result. If Chrome leaves the shortcut unassigned, the popup shows a warning with a Set Shortcut button that opens `chrome://extensions/shortcuts`. From the popup you can copy the final result, copy the raw transcript, retry the rewrite from the stored raw transcript, or open settings. While a session is mid-flight the popup also offers Cancel, which is the only way to abandon a session that the shortcut reports as busy.

On first use, if you close the microphone permission window without choosing, the session ends cleanly and the next shortcut press starts a new one. If Chrome suspends the extension's service worker while that window is open, granting access still resumes the original session and inserts into the field you started from.

## Privacy Notes

The current build sends microphone audio to the configured STT provider at `https://api.deepgram.com/*` and transcript text to the configured LLM provider at `https://generativelanguage.googleapis.com/*`.

The primary LLM model is `gemini-3.5-flash-lite`. If Google reports that model as unavailable for the current API key/project, the provider retries with `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`, and `gemini-2.5-flash` before falling back to the raw transcript. The Generate Content API does not store requests by default, so the extension omits the optional request-level `store` field for REST compatibility. Google documents that free-tier Gemini API content may be used to improve Google products; use a paid-tier project or a backend proxy if that is not acceptable for your data.

The latest successful result is kept temporarily in `chrome.storage.session` for popup recovery. Page overlays and generic runtime state snapshots still avoid exposing transcript text.

Permissions used today:

- `storage`: saves provider keys and the default style in extension storage.
- `offscreen`: records microphone audio from an offscreen document because the service worker cannot own media APIs.
- `activeTab` and `scripting`: inject the content script into the active tab after an unpacked extension reload when the static listener is missing.
- `clipboardWrite`: copies final text when the captured DOM target cannot be safely written.
- `https://api.deepgram.com/*`: sends recorded audio to Deepgram for speech-to-text.
- `https://generativelanguage.googleapis.com/*`: sends transcript text to Gemini for text improvement.

## Known Limitations

- Requires a saved Deepgram API key before transcription can complete.
- Requires a saved Gemini API key for non-Raw text improvement styles.
- Rich editor support now tries the browser editor `insertText` command before range insertion, but complex editors may still fall back to clipboard.
- Editors behind a closed shadow root cannot be reached; focus resolution stops at the shadow host.
- Recording is capped at five minutes per session.
- Popup retry reruns Gemini text improvement from the stored raw transcript; it does not perform a full audio/STT retry.
- Content scripts cannot run on restricted Chrome pages such as `chrome://extensions`.

## Troubleshooting

If the service worker logs `CONTENT_MODULE_LOAD_FAILED` or `Failed to fetch dynamically imported module`, rebuild, reload the extension, then refresh the target webpage. Existing tabs can retain old content-script instances after an unpacked extension reload.

If the service worker logs `Receiving end does not exist`, the active tab did not have the content script loaded. The command path now retries by injecting the content script into the active tab; this still cannot work on restricted pages such as `chrome://` URLs.

If the service worker logs `MICROPHONE_PERMISSION_DENIED`, use the microphone permission window opened by the extension. If you denied access previously, reset the extension's microphone permission in Chrome site settings for the `chrome-extension://` origin or reload the unpacked extension and try again.
