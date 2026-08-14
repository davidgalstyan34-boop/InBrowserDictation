# Architecture Proposal

## 1. Chosen Stack

- Language: dependency-free JavaScript with small shared modules and JSDoc-friendly shapes.
- Build: a Node script that copies `src/` into `dist/`.
- Tests: Node's built-in test runner for pure logic.
- Styling: plain CSS for options UI and Shadow DOM CSS for the in-page overlay.

This keeps the first implementation window focused on browser behavior instead of bundler configuration.

## 2. Manifest Design

- Manifest V3.
- `background.service_worker`: owns session state and command handling.
- `content_scripts`: loaded on normal pages to capture targets and show overlay feedback.
- `options_page`: stores provider keys and selected style.
- `commands`: `toggle-dictation`, defaulting to `Ctrl+Shift+Space` or `Command+Shift+Space`.
- Current permissions: `storage`, `offscreen`, `activeTab`, `scripting`, `clipboardWrite`.
- Current host permissions: `https://api.deepgram.com/*`, `https://generativelanguage.googleapis.com/*`.

`activeTab` and `scripting` let the command path inject the content-script entrypoint into the active tab when an already-open page has no receiver after an unpacked extension reload. Future phases should add only the permissions they need.

The Deepgram host permission is required for Phase 3 because the service worker posts the captured audio blob to the configured STT provider. The Google Generative Language host permission is required for Phase 4 because the service worker posts transcript text to the configured Gemini provider.

`clipboardWrite` is required for Phase 5 because the content script attempts to copy final text when the originally captured DOM target is detached, stale, unsupported, or unavailable.

## 3. Execution Contexts

Service worker:

- Authoritative session state.
- Keyboard command listener.
- Active tab selection.
- Owning-tab close detection and active-session cancellation.
- Message routing to content script.
- On-demand content-script injection for active tabs that missed static injection.
- Later: provider orchestration and normalized errors.

Content script:

- Captures active editable target at dictation start.
- Keeps DOM-bound target/range references local to the page.
- Performs eventual insertion or clipboard fallback.
- Shows in-page overlay state.

Offscreen document:

- Owns `getUserMedia` and `MediaRecorder`.
- Receives start/stop recording messages from the service worker.
- Returns captured audio data and metadata to the service worker.
- Cleans up media tracks and blobs.

Options page:

- Stores STT and LLM keys.
- Stores default style.
- Later: custom styles and validation helpers.

Popup:

- P1 only. It should reflect state and expose convenience controls, not be required for normal usage.

Background source layout:

- `background/service-worker.js`: Chrome event entrypoint only.
- `background/controller/`: session composition and lifecycle flows.
- `background/clients/`: Chrome API adapters for tabs, content scripts, offscreen recording, and permission pages.
- `background/providers/`: STT/LLM facades, provider implementations, provider errors, prompts, request signals, and audio payload conversion.
- `background/session/`: authoritative session shape, store, and public snapshots.
- `background/diagnostics/`: command/runtime diagnostics.
- `background/utils/`: small background-only helpers.

## 4. Audio Design

Manifest V3 service workers do not provide a stable DOM/media environment. Recording should use an offscreen document for microphone work.

Flow:

```text
command -> service worker -> offscreen recorder -> audio blob -> service worker
```

The recorder should:

- request microphone permission on start;
- use `MediaRecorder`;
- choose a provider-compatible MIME type such as `audio/webm`;
- stop all media tracks after recording;
- reject empty or tiny recordings before STT;
- report normalized microphone and recorder errors;
- return a JSON-safe audio payload because Chrome extension messaging should not depend on passing `Blob` objects directly.

## 5. Messaging Design

Messages use a small protocol envelope:

```js
{
  protocolVersion: 1,
  type: "content.prepareDictation",
  sessionId: "uuid",
  payload: {},
  sentAt: 123
}
```

Important message families:

- `content.prepareDictation`: capture target and show immediate feedback.
- `content.dismissOverlay`: remove terminal overlay feedback before a replacement session starts.
- `content.showState`: update overlay.
- `content.insertText`: insert final text into the captured target or copy it to the clipboard.
- `runtime.getState`: options/popup can inspect current service-worker state.
- `runtime.microphonePermissionResult`: visible permission page reports the first-run microphone grant result.
- `offscreen.getRecordingState`: recover an active recorder after service-worker suspension.
- `offscreen.startRecording`: request microphone permission and start `MediaRecorder`.
- `offscreen.stopRecording`: stop `MediaRecorder`, release tracks, and return the audio payload.

Every session-bound message carries `sessionId`. Receivers ignore stale session IDs.

## 6. Session State Machine

Authoritative state lives in the service worker.

Core statuses:

```text
IDLE
STARTING
WAITING_FOR_MICROPHONE
RECORDING
STOPPING
TRANSCRIBING
IMPROVING
INSERTING
SUCCESS
ERROR
```

Nominal final flow:

```text
IDLE -> STARTING -> RECORDING -> STOPPING -> TRANSCRIBING -> IMPROVING -> INSERTING -> SUCCESS -> IDLE
```

Fallback flow when LLM fails after STT succeeds:

```text
IMPROVING -> INSERTING(raw transcript) -> SUCCESS -> IDLE
```

Repeated commands:

- `IDLE`: start a new session.
- `STARTING`, `STOPPING`, provider and insertion states: ignore or show busy feedback.
- `RECORDING`: stop current session.
- `SUCCESS` or `ERROR`: reset to idle before accepting new work.

The Phase 5 implementation routes `IMPROVING -> INSERTING`, then completes after target insertion or clipboard fallback succeeds.

Target capture happens during `STARTING`; the session moves to `RECORDING` only after the offscreen document reports that `MediaRecorder` started.

If Chrome reports that the session's original tab closed, the service worker marks the session as `ERROR`, aborts active provider requests, and closes the offscreen recorder document. Unrelated tab closures are ignored.

First-run microphone flow:

```text
STARTING(target captured) -> WAITING_FOR_MICROPHONE -> RECORDING
```

Chrome requires the first microphone grant to come from a visible extension page. The service worker opens `permissions/microphone.html`, that page calls `getUserMedia({ audio: true })`, stops the test stream immediately, then reports the result back to the service worker.

## 7. Target Capture and Insertion Design

Capture happens in the content script immediately after the start command reaches the active tab.

For `input` and `textarea`:

- reject password, hidden, disabled, and readonly fields;
- store element reference in the content script;
- store selection start/end and value length;
- insert by replacing the captured selection and dispatching `input`.

For `contenteditable`:

- store editable root reference;
- clone the current DOM `Range` when it belongs to the editable root;
- insert text through range operations;
- dispatch `beforeinput`/`input` where practical.
- Phase 5 currently inserts a text node at the captured range; richer editor adapters are P1.

Changed focus:

- do not insert into the newly focused element.
- use the captured target if still valid.
- fallback to clipboard if target is detached, invalid, or insertion fails.

Phase 5 insertion response:

```js
insertText({ text }) -> { method, targetKind, textLength, fallbackReason }
```

The response never includes inserted text.

## 8. STT Provider Abstraction

Interface:

```js
transcribe({ audioBlob, mimeType, settings, signal }) -> { transcript, providerMeta }
```

Initial provider: Deepgram.

Provider code must normalize:

- authentication failures;
- rate limits;
- network and timeout failures;
- invalid JSON;
- empty transcript.

Provider details should not leak into state, insertion, or UI modules.

## 9. LLM Provider Abstraction

Interface:

```js
improveText({ text, style, settings, signal }) -> { text, providerMeta }
```

Initial provider: Gemini Generate Content API.

Current request shape:

- `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;
- `x-goog-api-key` header, rather than a query-string key;
- code-owned `systemInstruction` plus transcript `contents`;
- `store: false`.

Prompt rules:

- preserve meaning;
- do not add facts;
- preserve names, dates, numbers, URLs, identifiers, and quoted phrases unless correction is obvious;
- return only transformed text.

If LLM fails after STT succeeds, insert or copy the raw transcript and show a non-destructive warning.

Phase 5 preserves the fallback as private session output, then inserts or copies that output.

## 10. Storage Model

Minimal settings:

```js
{
  sttProvider: "deepgram",
  sttApiKey: "",
  llmProvider: "gemini",
  llmApiKey: "",
  defaultStyleId: "default",
  customStyles: []
}
```

Built-in styles are code-defined and versioned. Custom styles are P1.

Recent result is P1 and should store only the latest successful transcript unless the user explicitly asks for history.

## 11. UI Surfaces

Overlay:

- most important UI surface;
- visible immediately after shortcut;
- shows state, success, warning, and error messages;
- should auto-dismiss after successful dictation.

Options:

- provider sections;
- masked API keys;
- key readiness feedback and show/hide controls;
- default style selector;
- style-dependent Gemini requirement messaging;
- validation and save feedback.

Popup:

- P1 convenience only.

## 12. Security and Privacy

- Do not commit secrets.
- Do not log API keys.
- Store user-entered keys in extension storage for this take-home version.
- Document that production credentials should be backend-protected.
- Be explicit that audio goes to STT and transcript text goes to LLM.
- Gemini free-tier content may be used to improve Google products; use paid-tier Gemini credentials or a backend proxy for stricter data handling.
- Keep transcript and improved text out of logs and public runtime state snapshots.
- Keep host permissions and Chrome permissions minimal.

## 13. Testing

Unit tests:

- state transitions;
- message envelopes;
- recording helper behavior;
- settings validation;
- prompt construction when text improvement is implemented;
- provider response parsing;
- insertion helpers where pure.

Manual tests:

- input caret insertion;
- textarea insertion;
- selected text replacement;
- basic contenteditable;
- no focused editable target;
- focus changes while processing;
- missing config;
- denied microphone permission;
- STT succeeds and LLM fails.

Compatibility matrix should be documented before submission.

## 14. Risks

- MV3 service-worker suspension can interrupt long-running work if ownership is unclear.
- Microphone APIs belong outside the service worker.
- Rich editors may rerender and invalidate DOM ranges.
- Framework-controlled inputs may ignore naive `value` assignments.
- Clipboard writes can fail depending on permissions and user activation.
- Restricted pages cannot receive content scripts.
- Tab close/navigation should result in safe failure or clipboard fallback.

## 15. Implementation Sequence

P0 vertical path:

1. Runtime skeleton: manifest, service worker, content script, options storage, keyboard command, basic messaging.
2. Recording: offscreen recorder, microphone permission, start/stop, cleanup, audio blob.
3. Speech-to-text: Deepgram STT, provider abstraction, normalized errors.
4. Text improvement: LLM improvement, built-in styles, raw transcript fallback.
5. Insertion: target capture, safe insertion, contenteditable, clipboard fallback.
6. Product feedback: overlay and settings polish.

P1 after stable P0:

- custom styles;
- recent result;
- popup;
- richer editor compatibility;
- focused unit tests.

Drop first if schedule slips:

- popup;
- custom styles;
- recent result;
- advanced rich-editor adapters;
- visual polish beyond clear state feedback.
