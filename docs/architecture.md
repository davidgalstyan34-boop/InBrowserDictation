# Architecture

This describes the extension as it is built. Where a decision has a non-obvious
reason, the reason is stated with it. The build order that got here is recorded
at the end, separately, so it cannot be mistaken for a description of the
current design.

## 1. Stack

- Language: dependency-free JavaScript with small shared modules and JSDoc-friendly shapes.
- Build: a Node script that copies `src/` into `dist/`.
- Tests: Node's built-in test runner for pure logic.
- Styling: plain CSS for options UI and Shadow DOM CSS for the in-page overlay.

This keeps the first implementation window focused on browser behavior instead of bundler configuration.

## 2. Manifest Design

- Manifest V3.
- `background.service_worker`: owns session state and command handling.
- `content_scripts`: loaded in every frame of normal pages to capture targets and show overlay feedback.
- `options_page`: stores provider keys and selected style.
- `commands`: `toggle-dictation`, defaulting to `Ctrl+Shift+Space` or `Command+Shift+Space`.
- Current permissions: `storage`, `offscreen`, `activeTab`, `scripting`, `clipboardWrite`.
- Current host permissions: `https://api.deepgram.com/*`, `https://generativelanguage.googleapis.com/*`.

`activeTab` and `scripting` let the command path inject the content-script entrypoint into the active tab when an already-open page has no receiver after an unpacked extension reload. New permissions are added only when something needs them.

The Deepgram host permission is needed because the service worker posts the captured audio blob to the STT provider. The Google Generative Language host permission is needed because the service worker posts transcript text to the Gemini provider.

`clipboardWrite` is needed because the content script copies final text when the originally captured DOM target is detached, stale, unsupported, or unavailable.

## 3. Execution Contexts

Service worker:

- Authoritative session state.
- Keyboard command listener.
- Active tab selection.
- Owning-tab close detection and active-session cancellation.
- Message routing to content script.
- On-demand content-script injection for active tabs that missed static injection.
- Provider orchestration and normalized errors.

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
- Creates, edits, deletes, and selects custom rewrite styles.
- Shows validation, key readiness, and style-dependent provider requirements.

Popup:

- Reflects current status, selected style, and Chrome's active shortcut assignment.
- Provides optional start/stop, latest-result copy, raw-transcript copy, retry rewrite, and settings access.
- Remains secondary; normal usage does not require opening it.

Background source layout:

- `background/service-worker.js`: Chrome event entrypoint only.
- `background/controller/`: session composition and lifecycle flows.
- `background/clients/`: Chrome API adapters for tabs, content scripts, offscreen recording, and permission pages.
- `background/providers/`: STT/LLM facades, provider implementations, provider errors, prompts, request signals, and audio payload conversion.
- `background/session/`: authoritative session shape, store, and public snapshots.
- `background/diagnostics/`: command/runtime diagnostics.
- `background/utils/`: small background-only helpers.

## 4. Audio Design

Manifest V3 service workers do not provide a stable DOM/media environment, so microphone work happens in an offscreen document.

Flow:

```text
command -> service worker -> offscreen recorder -> audio blob -> service worker
```

The recorder:

- requests microphone permission on start;
- uses `MediaRecorder`;
- chooses a provider-compatible MIME type such as `audio/webm`;
- stops all media tracks after recording;
- stops at a maximum recording length, keeping the audio captured so far and telling the service worker to continue the pipeline;
- rejects empty or tiny recordings before STT;
- reports normalized microphone and recorder errors;
- returns a JSON-safe audio payload, because extension messaging cannot be relied on to structured-clone `Blob` objects across every Chrome context.

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
- `runtime.getPopupState`: popup-only state, including the current session snapshot and the latest recoverable result text.
- `runtime.clearRecentResult`: forget the stored latest result.
- `runtime.microphonePermissionResult`: visible permission page reports the first-run microphone grant result. The payload echoes the session's tab id so a suspended service worker can rebuild the session instead of discarding a grant.
- `runtime.toggleDictation`: popup entrypoint into the same policy as the keyboard command.
- `runtime.cancelDictation`: popup entrypoint that abandons a session stuck in a non-toggleable state.
- `runtime.retryRecentImprovement`: rerun LLM improvement from the stored latest raw transcript.
- `offscreen.getRecordingState`: recover an active recorder after service-worker suspension.
- `offscreen.recordingDurationCapped`: the recorder stopped itself at the maximum recording length and is holding the audio.
- `offscreen.startRecording`: request microphone permission and start `MediaRecorder`.
- `offscreen.stopRecording`: stop `MediaRecorder`, release tracks, and return the audio payload.

Every session-bound message carries `sessionId`. Receivers ignore stale session IDs, and the background session store rejects mutations whose `sessionId` no longer matches the current session so a late callback cannot advance its successor.

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

Improvement routes into `INSERTING` whether it succeeded or fell back, and the session completes once target insertion or clipboard fallback succeeds.

Target capture happens during `STARTING`; the session moves to `RECORDING` only after the offscreen document reports that `MediaRecorder` started.

If Chrome reports that the session's original tab closed, the service worker marks the session as `ERROR`, aborts active provider requests, and closes the offscreen recorder document. Unrelated tab closures are ignored.

First-run microphone flow:

```text
STARTING(target captured) -> WAITING_FOR_MICROPHONE -> RECORDING
```

Chrome requires the first microphone grant to come from a visible extension page. The service worker opens `permissions/microphone.html`, that page calls `getUserMedia({ audio: true })`, stops the test stream immediately, then reports the result back to the service worker. A denied Permissions API state avoids a request that cannot prompt again, while every other state is verified with `getUserMedia()` because macOS can block Chrome itself even when Chrome reports the extension origin as granted. Denial changes the page action to Go to settings and opens `chrome://settings/content/microphone` for recovery.

Two failure modes are handled explicitly, because both otherwise park the session in `WAITING_FOR_MICROPHONE` with no way out:

- Closing the window without choosing reports a `MICROPHONE_PERMISSION_DISMISSED` denial from `pagehide`, so the session fails instead of waiting forever.
- The service worker can be suspended while the user reads Chrome's prompt, which discards the in-memory session. A granted result whose session id is unknown, arriving while the store is idle, rebuilds the session from the echoed session id and tab id and continues into recording; the content script still holds the captured target under that same session id. A dismissed result in the same situation is ignored, because nothing is stuck.

No state is left waiting indefinitely:

- A watchdog fails any session that stays in `STARTING`, `WAITING_FOR_MICROPHONE`, `STOPPING`, `TRANSCRIBING`, `IMPROVING`, or `INSERTING` past a per-state deadline. `RECORDING` is exempt because a long dictation is legitimate. A plain timer suffices: it only has to cover hangs while the worker is alive, and a suspended worker discards the session anyway.
- The popup exposes an explicit cancel for any busy state, since the shortcut only reports "busy" there.

## 7. Target Capture and Insertion Design

Capture happens in the content script immediately after the start command reaches the active tab.

The content script runs in every frame, because many editors (mail compose windows, embedded rich editors) live in an iframe where the top document's active element is only the frame itself. That makes message routing explicit, since `tabs.sendMessage` delivers a broadcast to every frame but surfaces only one arbitrary response:

- Overlay updates target the top frame. An overlay drawn inside a small, scrolled, or hidden iframe would be clipped or invisible.
- Dismissals broadcast, because the overlay and the captured target can live in different frames and each has to be released.
- Capture and insertion need a response, so exactly one frame answers. A frame claims the session only when the focused element is in it: focus is unique across a frame tree, and ancestors are excluded because their active element is the frame holding focus. When nothing in the tab has focus, the top frame claims, which keeps a page with no editable target behaving as before. If no frame claims, the top frame is asked again with `requireClaim`, so the clipboard fallback still has an owner.

Focus is resolved through open shadow roots, since `document.activeElement` stops at the shadow host and would otherwise report a web-component wrapper instead of the editor inside it.

A target the content script rejects on purpose (`kind: "blocked"`) fails the session before recording starts, so no audio is captured and nothing reaches a provider or the clipboard. That is distinct from "nothing editable was focused" (`kind: "none"`), which still records and falls back to the clipboard.

For `input` and `textarea`:

- reject password, hidden, disabled, and readonly fields;
- store element reference in the content script;
- store selection start/end and value length;
- insert by replacing the captured selection and dispatching `input`.

For `contenteditable`:

- store editable root reference;
- clone the current DOM `Range` when it belongs to the editable root;
- capture selection-owned editors even when the active element is not itself the editor;
- try the browser editor `insertText` command first;
- fall back to range operations with `beforeinput`/`input` dispatch where practical.

Changed focus:

- do not insert into the newly focused element.
- use the captured target if still valid.
- fallback to clipboard if target is detached, invalid, or insertion fails.

Insertion response:

```js
insertText({ text }) -> { method, targetKind, textLength, fallbackReason }
```

The response never includes inserted text.

## 8. STT Provider Abstraction

Interface:

```js
transcribe({ audioBlob, mimeType, settings, signal }) -> { transcript, providerMeta }
```

Current provider: Deepgram. The facade dispatches on the stored `sttProvider`.

Provider code must normalize:

- authentication failures;
- rate limits;
- network and timeout failures;
- invalid JSON;
- empty transcript.

Provider details do not leak into state, insertion, or UI modules.

## 9. LLM Provider Abstraction

Interface:

```js
improveText({ text, style, settings, signal }) -> { text, providerMeta }
```

Current provider: Gemini Generate Content API. The facade dispatches on the stored `llmProvider`.

Current request shape:

- `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;
- `x-goog-api-key` header, rather than a query-string key;
- code-owned system-instruction content plus transcript `contents`;
- omits the optional `store` field because Generate Content does not store requests by default, and older REST surfaces may reject that field.

Compatibility handling:

- sends a REST-minimal body first, then retries alternate system-instruction field shapes only if the provider rejects the request shape;
- falls back from `gemini-3.5-flash-lite` to `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`, and `gemini-2.5-flash` only when the provider reports model unavailability;
- remembers the model and request shape that worked in `chrome.storage.session` and tries that combination first. Without this, an account whose primary model is unavailable re-walks the whole ladder on every dictation, paying failed round-trips inside the same timeout budget as the request that matters. The memory is session-scoped because model availability can change under the account, and a remembered pair this build no longer offers is discarded.

Provider selection is a real lookup: the STT and LLM facades dispatch on the stored `sttProvider` and `llmProvider` settings through a registry. A test asserts those registries match the provider lists the options page validates against, so the two cannot drift into a state where a user selects one provider and another one runs.

Prompt rules:

- preserve meaning;
- do not add facts;
- preserve names, dates, numbers, URLs, identifiers, and quoted phrases unless correction is obvious;
- return only transformed text.

If LLM fails after STT succeeds, insert or copy the raw transcript and show a non-destructive warning.

The fallback is kept as private session output, which is then inserted or copied.

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

Built-in styles are code-defined and versioned. Custom styles are stored as normalized records with generated stable ids, display names, optional descriptions, and rewrite instructions. Built-ins remain code-defined and keep priority over custom ids.

The popup can clear the stored result on demand, so a user does not have to wait for the browser session to end to take it out of storage.

The latest result is stored temporarily in `chrome.storage.session`. It includes the final text, raw transcript, style id, insertion metadata, and timestamps. It does not build a history.

The record is written as soon as final text exists, before insertion is attempted, and rewritten afterwards with insertion metadata. Insertion is the step most likely to fail irrecoverably — a detached target plus a clipboard write the browser refuses — and nothing else holds that text, because overlays deliberately never echo it. Saving only on success would keep a record exactly when it is least needed.

## 11. UI Surfaces

Overlay:

- most important UI surface;
- visible immediately after shortcut;
- shows state, success, warning, and error messages;
- auto-dismisses after successful dictation.

Options:

- provider sections;
- masked API keys;
- key readiness feedback and show/hide controls;
- default style selector;
- custom style management;
- style-dependent Gemini requirement messaging;
- validation and save feedback.

Popup:

- status, style, actual shortcut assignment, start/stop;
- latest final result display and copy;
- raw transcript copy;
- retry rewrite from the latest raw transcript.

## 12. Security and Privacy

- Do not commit secrets.
- Do not log API keys.
- Store user-entered keys in extension storage for this take-home version.
- Document that production credentials should be backend-protected.
- Be explicit that audio goes to STT and transcript text goes to LLM.
- Gemini free-tier content may be used to improve Google products; use paid-tier Gemini credentials or a backend proxy for stricter data handling.
- Keep transcript and improved text out of logs and public runtime state snapshots.
- Expose latest result text only through the explicit popup state/recovery message.
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

A compatibility matrix across target editors is still to be documented.

## 14. Risks

- MV3 service-worker suspension can interrupt long-running work if ownership is unclear.
- Microphone APIs belong outside the service worker.
- Rich editors may rerender and invalidate DOM ranges.
- Framework-controlled inputs may ignore naive `value` assignments.
- Clipboard writes can fail depending on permissions and user activation.
- Restricted pages cannot receive content scripts.
- Tab close/navigation should result in safe failure or clipboard fallback.

## 15. Build History

This section is history, not design. It records the order the extension was
built in, which explains why some modules exist as separate layers. Nothing here
describes current behavior; the sections above do.

The vertical path, each step a working slice:

1. Runtime skeleton: manifest, service worker, content script, options storage, keyboard command, basic messaging.
2. Recording: offscreen recorder, microphone permission, start/stop, cleanup, audio blob.
3. Speech-to-text: Deepgram STT, provider abstraction, normalized errors.
4. Text improvement: LLM improvement, built-in styles, raw transcript fallback.
5. Insertion: target capture, safe insertion, contenteditable, clipboard fallback.
6. Product feedback: overlay and settings polish.
7. Differentiation: custom styles, latest-result recovery, popup controls, retry rewrite, richer editor compatibility, and focused unit tests.

A subsequent review pass addressed correctness and coverage:

- Error normalization: browser `DOMException`s were passing through the
  "already normalized?" guard because their legacy `code` is numeric, which made
  every timeout and cancellation message unreachable.
- Session identity: the session store now rejects mutations from a superseded
  session, and overlapping toggles are dropped rather than started.
- Recoverability: the final text is stored before insertion is attempted, and
  states that could not exit on their own now have deadlines and a cancel.
- Reach: content scripts run in every frame and resolve focus through shadow
  roots, so iframe and web-component editors are supported.
