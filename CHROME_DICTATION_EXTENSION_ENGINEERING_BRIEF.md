# Chrome Dictation Extension — Product & Engineering Brief

## 1. Purpose of this document

This document is the source of truth for designing and implementing a polished Chrome dictation extension.

It is intended to be consumed by an AI coding agent such as **Codex** or **Claude Code**.

The goal is **not** to maximize feature count. The goal is to build the smallest product that feels reliable, deliberate, fast, and close to production quality within a **5-day implementation window**, with heavy AI-assisted development.

Before writing substantial implementation code, use this document to produce:

1. A proposed architecture.
2. A component/module breakdown.
3. A Chrome extension lifecycle and messaging design.
4. A data-flow diagram.
5. A state machine.
6. A risk/edge-case analysis.
7. A concrete implementation sequence.
8. A test strategy.
9. A 5-day execution plan.

Do **not** overengineer beyond the priorities defined here.

---

# 2. Assignment

## Goal

Build a Chrome extension for dictation.

The user should be able to:

1. Trigger recording with a keyboard shortcut.
2. Speak.
3. Get text back via speech-to-text.
4. Have that text improved by an LLM.
5. Apply a reusable style/pattern, such as a professional or email style.
6. Insert the improved text where the user was typing.
7. If the user was not typing in an editable field, copy the result to the clipboard.

## Constraints

- Must be a Chrome extension.
- Must be loadable as an unpacked extension.
- May use any STT provider.
- May use any LLM provider.
- Deepgram is a reasonable STT option.
- Project must be fully buildable and runnable from the README.
- No missing setup steps.
- No broken commands.
- No secrets committed to source control.
- README must explain build, configuration, installation, and usage.

---

# 3. Product principle

The core interaction should feel approximately like:

```text
Shortcut
→ speak
→ shortcut / stop
→ brief processing
→ polished text appears at the original cursor position
```

The extension should require **zero mouse interaction during normal dictation**.

The product should optimize for:

- reliability;
- low friction;
- strong perceived speed;
- predictable behavior;
- recovery from failures;
- minimal surprise;
- polished UX.

The most important invariant is:

> Once meaningful speech has been successfully transcribed, the user's text should not be silently lost.

---

# 4. Scope strategy

The project has only five days.

Therefore:

- **P0** = required for a successful submission.
- **P1** = high-value polish and differentiation.
- **P2** = only implement if P0 and P1 are stable.
- **NON-GOAL** = explicitly avoid unless implementation becomes trivial.

A smaller stable product is better than a broad unstable product.

---

# 5. Functional requirements

---

## P0 — Core requirements

These are mandatory.

---

### FR-P0-01 — Keyboard shortcut starts dictation

The user must be able to start dictation using a Chrome extension keyboard shortcut.

Requirements:

- Must work without opening the popup.
- Must not create duplicate recording sessions.
- Must provide immediate feedback that the command was received.
- Shortcut configuration should use the Chrome commands API.

Expected behavior:

```text
Idle
→ shortcut
→ recording starts
```

---

### FR-P0-02 — Keyboard shortcut stops dictation

The same shortcut should preferably behave as a toggle.

Expected behavior:

```text
Recording
→ shortcut
→ recording stops
→ processing begins
```

Do not start another recording while processing.

---

### FR-P0-03 — Microphone capture

The extension must:

- request microphone permission appropriately;
- capture usable audio;
- start quickly;
- stop cleanly;
- release microphone resources after recording;
- handle permission denial;
- handle missing/unavailable microphones;
- avoid keeping the microphone active while idle.

---

### FR-P0-04 — Speech-to-text

After recording:

- send audio to the configured STT provider;
- use the correct audio format/MIME type;
- parse the provider response;
- extract a transcript;
- detect empty/no-speech results;
- surface provider/network errors.

Good STT settings should enable punctuation and capitalization where supported.

---

### FR-P0-05 — LLM text improvement

The raw transcript must be passed to an LLM.

Default behavior should:

- fix grammar;
- fix punctuation;
- remove obvious verbal filler;
- improve readability;
- preserve meaning;
- avoid adding facts;
- avoid changing names, numbers, URLs, identifiers, technical terminology, dates, or quoted phrases unnecessarily.

Example:

Raw:

```text
uh hey john basically i wanted to ask if you can maybe send me the report by friday
```

Improved:

```text
Hey John, could you send me the report by Friday?
```

---

### FR-P0-06 — Built-in reusable styles

Provide a small fixed set of reusable styles.

Recommended built-ins:

1. **Default**
   - natural;
   - light cleanup;
   - preserve tone.

2. **Professional**
   - concise;
   - polished;
   - businesslike.

3. **Email**
   - suitable for email;
   - professional;
   - clear structure where appropriate.

4. **Casual**
   - conversational;
   - minimal rewriting.

5. **Raw**
   - bypass LLM rewriting or apply near-zero transformation.

Do not add dozens of styles.

---

### FR-P0-07 — Select a default style

The user must be able to select the style used for normal dictation.

The selected style should persist across browser sessions.

---

### FR-P0-08 — Detect editable target

The extension should determine where the user intended dictation to be inserted.

At minimum support:

- `<input>` elements that accept ordinary text;
- `<textarea>`;
- basic `contenteditable` elements.

Do not dictate into:

- password fields;
- disabled fields;
- read-only fields.

---

### FR-P0-09 — Preserve original insertion target

The extension should remember the editable target that was active when dictation started.

If processing takes several seconds and the user clicks elsewhere, the result must not be inserted into a random newly focused field.

Preferred behavior:

1. Capture the original target and selection/caret.
2. When text is ready, insert back into the original target if it is still valid.
3. If the original target is no longer safe/available, use clipboard fallback.

---

### FR-P0-10 — Preserve cursor/selection

For inputs and textareas:

- insert at the original caret;
- replace selected text if a selection existed;
- preserve text before and after the insertion.

Example:

Before:

```text
Hello | how are you?
```

Dictated:

```text
John,
```

After:

```text
Hello John,| how are you?
```

Selection example:

Before:

```text
Hello [old sentence] goodbye
```

After dictation:

```text
Hello new sentence goodbye
```

---

### FR-P0-11 — Insert into `contenteditable`

Support standard `contenteditable` elements.

The implementation should:

- capture an appropriate DOM selection/range;
- restore it where possible;
- insert text without unnecessarily destroying surrounding content;
- trigger relevant browser events when practical.

Perfect compatibility with every rich editor is **not** required.

---

### FR-P0-12 — Trigger appropriate input/change behavior

Modern websites may rely on framework state.

Insertion should attempt to behave like genuine user editing.

At minimum:

- update element content/value correctly;
- dispatch relevant `input` events;
- preserve cursor position;
- avoid obviously breaking React/Vue/Angular-controlled inputs.

Avoid assuming `element.value = text` alone is sufficient.

---

### FR-P0-13 — Clipboard fallback

If there is no suitable editable target:

- copy the final result to the clipboard;
- show feedback indicating that copying occurred.

Clipboard fallback must also be used when:

- the original target disappeared;
- insertion fails;
- the target becomes invalid;
- the editor is unsupported.

---

### FR-P0-14 — User-visible state feedback

The user should always understand what the extension is doing.

Recommended states:

```text
Idle
Starting
Listening
Transcribing
Improving
Inserting
Copied
Error
```

A small in-page overlay is preferred.

Examples:

```text
● Listening…
```

```text
Transcribing…
```

```text
Copied to clipboard
```

The overlay should be unobtrusive and disappear automatically after success.

---

### FR-P0-15 — Basic configuration

The extension must provide a settings/options interface for required configuration.

At minimum:

- STT API key;
- LLM API key;
- selected default style.

If the project uses environment variables during build instead of runtime-entered API keys, the README must make that setup completely explicit.

---

### FR-P0-16 — Missing configuration handling

Do not fail with a cryptic `401`.

If required configuration is missing, show a clear message such as:

```text
Deepgram API key is not configured.
Open extension settings to continue.
```

---

### FR-P0-17 — Error handling

Explicitly handle at least:

- microphone permission denied;
- microphone unavailable;
- empty/silent recording;
- STT authentication failure;
- STT rate limit;
- STT network/timeout failure;
- LLM authentication failure;
- LLM rate limit;
- LLM network/timeout failure;
- malformed provider response;
- insertion failure;
- clipboard failure.

Errors should be actionable where practical.

---

### FR-P0-18 — Raw transcript recovery

If STT succeeds but LLM improvement fails, the successful raw transcript must not be lost.

Preferred fallback behavior:

```text
LLM improvement failed.
Using raw transcript instead.
```

Then either:

- insert raw text automatically; or
- copy raw text to clipboard.

Choose one behavior and document it.

---

### FR-P0-19 — Prevent race conditions

The extension must not allow:

- multiple simultaneous recordings;
- duplicate STT submissions;
- duplicate LLM requests;
- repeated insertion of the same result;
- command spam to corrupt internal state.

Use a clear state machine.

---

### FR-P0-20 — README

The README is part of the product.

A reviewer should be able to go from clone to working extension without guessing.

Required README sections:

- project overview;
- feature summary;
- architecture overview;
- prerequisites;
- STT setup;
- LLM setup;
- environment/configuration;
- install dependencies;
- build;
- test;
- load unpacked extension;
- configure extension;
- usage;
- keyboard shortcut;
- known limitations;
- troubleshooting;
- privacy/security notes.

No hidden steps.

---

# 6. P1 — High-value differentiation

Implement these after P0 is end-to-end stable.

---

### FR-P1-01 — Custom reusable styles

Allow users to define custom styles.

Suggested model:

```text
Name:
Engineering Slack

Instructions:
Write concise technical messages.
Preserve code identifiers and technical terminology.
Avoid unnecessary explanation.
Use bullets when helpful.
```

Capabilities:

- create;
- edit;
- delete;
- select as default.

Do not build a sophisticated style marketplace or template system.

---

### FR-P1-02 — Recent result recovery

Keep at least the most recent successful dictation result available temporarily.

Useful UI:

```text
Last dictation

"Could you send me the report by tomorrow?"

[Copy]
```

Purpose:

- recovery if page insertion behaves unexpectedly;
- confidence during evaluation.

Do not build full history unless trivial.

---

### FR-P1-03 — Polished options page

The settings page should feel deliberate rather than like a debugging form.

Include:

- clear provider sections;
- masked API key inputs;
- validation;
- style selection;
- custom style management if implemented;
- concise help text.

---

### FR-P1-04 — Popup control surface

A popup may show:

```text
Dictation

Status: Ready
Style: Professional
Shortcut: Ctrl+Shift+Space

[Start Dictation]

Last result:
...
```

The popup is secondary.

Normal usage should not depend on it.

---

### FR-P1-05 — Stronger rich-editor compatibility

Test and improve behavior on common `contenteditable` environments.

Recommended manual targets:

- Gmail compose;
- Slack;
- LinkedIn;
- simple contenteditable test page.

Do not spend excessive time chasing Google Docs or highly customized editors.

---

### FR-P1-06 — Retry/recovery actions

Where easy, provide actions such as:

- retry STT;
- retry LLM;
- copy raw transcript;
- copy final transcript.

Only add these if state management remains clear.

---

### FR-P1-07 — Thoughtful visual polish

Include:

- consistent typography;
- clear success/error states;
- subtle animation;
- no layout jumping;
- no intrusive full-screen UI;
- visible keyboard focus;
- usable dark/light appearance if easy.

The recording overlay is more important than decorative popup polish.

---

### FR-P1-08 — Unit tests for critical pure logic

Recommended coverage:

- prompt construction;
- style selection;
- STT response parsing;
- configuration validation;
- state transitions;
- insertion logic where practical.

Do not chase arbitrary coverage percentages.

---

### FR-P1-09 — Manual compatibility matrix

Document tested behavior.

Example:

| Scenario | Expected behavior |
|---|---|
| Plain input | Insert at caret |
| Textarea | Insert at caret |
| Selected text | Replace selection |
| Basic contenteditable | Insert |
| Gmail compose | Insert or documented fallback |
| No focused field | Clipboard |
| Read-only input | Clipboard |
| Password input | Never insert |
| STT unavailable | Clear error |
| LLM unavailable | Raw transcript preserved |

---

# 7. P2 — Only if core product is already excellent

These features are optional.

Do **not** jeopardize reliability to add them.

---

### FR-P2-01 — Streaming STT

Potential benefits:

- lower perceived latency;
- live transcript.

Costs:

- more complex audio lifecycle;
- more complex provider integration;
- more failure modes;
- more state management.

Only implement if the provider integration is already stable.

---

### FR-P2-02 — Silence auto-stop

Automatically stop after configurable silence.

Risks:

- accidental early stop;
- false silence detection;
- more audio logic.

Not required.

---

### FR-P2-03 — Language selection or auto-detection

Useful but secondary.

If implemented:

- persist preference;
- expose automatic mode;
- ensure STT provider supports it.

---

### FR-P2-04 — Per-site settings

Examples:

- different styles for Gmail vs Slack;
- disabled sites;
- special editor adapters.

Interesting, but not needed in five days.

---

### FR-P2-05 — Multiple STT/LLM providers

Architecture should make swapping providers possible.

UI support for multiple providers is not necessary.

Prefer one provider implemented well.

---

### FR-P2-06 — Full dictation history

Do not build a database-like history experience unless all higher priorities are complete.

---

# 8. Explicit non-goals

For this five-day project, avoid the following unless essentially free:

- perfect support for every rich text editor;
- Google Docs-specific deep integration;
- transcription of browser/tab audio;
- speaker diarization;
- multi-user collaboration;
- cloud accounts;
- billing;
- sync across devices;
- advanced analytics;
- multiple STT providers in UI;
- multiple LLM providers in UI;
- complex onboarding wizard;
- auto-send messages/emails;
- background continuous recording;
- wake-word detection;
- native application integration;
- Firefox/Safari support;
- full offline speech recognition;
- enterprise policy management.

---

# 9. Non-functional requirements

---

## NFR-01 — Perceived responsiveness

Target:

- shortcut feedback should appear nearly instantly;
- UI should never appear frozen;
- transition into `Listening` as quickly as browser APIs permit.

Perceived response target:

```text
< 200 ms for visible command acknowledgement
```

Do not block UI while initializing network/provider work.

---

## NFR-02 — End-to-end latency

After the user stops speaking, aim for approximately:

```text
1–3 seconds
```

when provider/network conditions are favorable.

External services may dominate total latency.

Architecture should avoid unnecessary local delay.

---

## NFR-03 — Reliability

Critical invariant:

> Never silently discard a successfully obtained transcript.

Recovery order should conceptually be:

```text
Insert into intended field
→ if impossible, copy to clipboard
→ if LLM failed, preserve raw STT transcript
```

---

## NFR-04 — Minimal idle overhead

While idle:

- do not continuously scan the DOM;
- avoid aggressive MutationObservers;
- avoid polling;
- avoid retaining audio buffers;
- avoid unnecessary network calls.

---

## NFR-05 — Resource cleanup

After each session:

- stop MediaRecorder;
- stop microphone tracks;
- release audio blobs when no longer needed;
- clear temporary object URLs;
- discard stale target references;
- discard stale transcript state where appropriate.

---

## NFR-06 — Network efficiency

Normal successful dictation should ideally require:

```text
1 STT request
+
1 LLM request
```

Avoid redundant API calls.

---

## NFR-07 — Security

Requirements:

- no API keys committed;
- no secrets in logs;
- keys masked in UI;
- minimal Chrome permissions;
- no unnecessary host permissions;
- document provider data flow.

Important architectural note:

For a take-home project, user-entered provider keys stored in extension storage may be acceptable.

The README should explain that for a real production deployment, provider credentials would typically be protected behind a backend or authenticated service rather than shipping a shared secret inside the extension.

---

## NFR-08 — Privacy transparency

Make it clear that:

- microphone audio is sent to the configured STT provider;
- transcript text is sent to the configured LLM provider.

Do not claim audio stays local if it does not.

---

## NFR-09 — Maintainability

Prefer small modules with clear responsibilities.

Avoid a giant service worker or content script containing all logic.

Recommended conceptual boundaries:

```text
audio/
stt/
llm/
insertion/
styles/
storage/
state/
ui/
```

Exact folder layout should be chosen during architecture design.

---

## NFR-10 — Provider abstraction

Define narrow interfaces such as:

```js
transcribe(audio) -> transcript
```

```js
improve(text, style) -> improvedText
```

The implementation may use only one provider, but provider-specific details should not leak throughout the application.

---

## NFR-11 — Explicit application state

Use a finite state model.

Recommended conceptual states:

```text
IDLE
STARTING
RECORDING
STOPPING
TRANSCRIBING
IMPROVING
INSERTING
SUCCESS
ERROR
```

Not every state must be externally visible.

Transitions must be deliberate.

Examples:

```text
IDLE
→ STARTING
→ RECORDING
→ TRANSCRIBING
→ IMPROVING
→ INSERTING
→ IDLE
```

Failure example:

```text
IMPROVING
→ raw transcript fallback
→ INSERTING
→ IDLE
```

---

## NFR-12 — Accessibility

At minimum:

- keyboard-accessible controls;
- semantic form elements;
- labels for settings fields;
- visible focus states;
- state not conveyed by color alone;
- sufficient contrast.

---

## NFR-13 — Build reproducibility

The project should work on a clean machine by following the README.

Required:

- deterministic dependency installation;
- explicit Node/npm/pnpm requirements;
- explicit build command;
- explicit output directory;
- explicit `Load unpacked` directory;
- no locally assumed files.

---

# 10. Suggested user experience

---

## Normal flow

```text
User focuses textarea at cursor position
↓
User presses shortcut
↓
Overlay: "Listening…"
↓
User speaks
↓
User presses shortcut
↓
Overlay: "Transcribing…"
↓
STT returns raw transcript
↓
Overlay: "Improving…"
↓
LLM returns improved transcript
↓
Text inserted at original cursor
↓
Overlay: "Inserted"
↓
Overlay disappears
```

---

## No editable field

```text
Shortcut
↓
Speak
↓
Stop
↓
STT
↓
LLM
↓
No valid insertion target
↓
Copy to clipboard
↓
Overlay: "Copied to clipboard"
```

---

## LLM failure

```text
STT succeeds
↓
LLM fails
↓
Preserve raw transcript
↓
Insert or copy raw transcript
↓
Show non-destructive warning
```

---

## Target disappears during processing

```text
Capture original target
↓
Process audio
↓
Original DOM target no longer valid
↓
Do NOT insert into newly focused random element
↓
Copy result to clipboard
↓
Notify user
```

---

# 11. Architecture questions the implementation agent must answer

Before implementation, produce a design document answering the following.

---

## Chrome extension responsibilities

Decide which logic belongs in:

- service worker/background;
- content script;
- offscreen document, if needed;
- popup;
- options page;
- shared modules.

Explain the reasoning.

---

## Microphone lifecycle

Determine:

- where `getUserMedia` is called;
- where `MediaRecorder` lives;
- whether Manifest V3 service-worker limitations require an offscreen document;
- how start/stop commands reach the recorder;
- how the recorder survives the required lifecycle;
- how microphone permissions are requested cleanly.

Do not assume the background service worker has DOM/media capabilities it does not have.

---

## Messaging

Define message contracts.

Examples might include:

```text
START_RECORDING
STOP_RECORDING
RECORDING_STARTED
RECORDING_STOPPED
PROCESSING_STATE_CHANGED
DICTATION_COMPLETED
DICTATION_FAILED
```

Do not use loosely structured arbitrary messages everywhere.

---

## Target/selection capture

Define exactly:

- when the active editable element is captured;
- how input/textarea selections are stored;
- how contenteditable ranges are stored or reconstructed;
- what happens if the target is detached;
- what happens after SPA rerenders;
- what happens if focus changes.

---

## Processing ownership

Determine where:

- STT API calls happen;
- LLM API calls happen;
- API keys are read;
- errors are normalized;
- retries, if any, happen.

Keep provider code independent from DOM insertion code.

---

## State ownership

Choose one authoritative owner for the dictation session state.

Avoid duplicated state machines in multiple contexts.

Explain:

- who owns `IDLE/RECORDING/PROCESSING`;
- how UI receives state updates;
- what happens if popup opens/closes mid-session;
- how stale messages are ignored.

Consider using a session/request ID.

---

# 12. Recommended conceptual module boundaries

This is a suggestion, not a mandatory folder structure.

```text
src/
  background/
    service-worker.*

  content/
    content-script.*
    target-capture.*
    insertion.*
    overlay.*

  recorder/
    recorder.*
    offscreen.*          # if architecture requires it

  providers/
    stt/
      interface.*
      deepgram.*
    llm/
      interface.*
      openai-or-selected-provider.*

  styles/
    builtins.*
    prompt-builder.*

  storage/
    settings.*
    schema.*

  state/
    dictation-state.*
    messages.*

  popup/
    ...

  options/
    ...
```

Prefer clear interfaces over many layers.

Do not introduce unnecessary dependency injection frameworks or enterprise abstractions.

---

# 13. Suggested data model

A minimal settings model may resemble:

```ts
type Settings = {
  sttApiKey: string;
  llmApiKey: string;
  defaultStyleId: string;
  customStyles: CustomStyle[];
};
```

Custom style:

```ts
type CustomStyle = {
  id: string;
  name: string;
  instructions: string;
};
```

Session state may resemble:

```ts
type DictationSession = {
  id: string;
  status: DictationStatus;
  startedAt: number;
  targetSnapshot?: TargetSnapshot;
  rawTranscript?: string;
  finalTranscript?: string;
  error?: AppError;
};
```

Exact implementation may differ.

---

# 14. Error model

Prefer normalized application errors.

Example categories:

```text
MIC_PERMISSION_DENIED
MIC_UNAVAILABLE
RECORDING_FAILED

STT_AUTH
STT_RATE_LIMIT
STT_NETWORK
STT_EMPTY_RESULT
STT_INVALID_RESPONSE

LLM_AUTH
LLM_RATE_LIMIT
LLM_NETWORK
LLM_INVALID_RESPONSE

TARGET_INVALID
INSERTION_FAILED
CLIPBOARD_FAILED

CONFIG_MISSING
UNKNOWN
```

Provider-specific HTTP details may be logged in development but should be converted into useful product-facing errors.

---

# 15. Prompt design requirements

The LLM system/prompt design should make the transformation conservative.

Core instruction:

> Improve the transcript according to the selected style while preserving the speaker's intended meaning. Do not invent facts. Preserve names, numbers, dates, URLs, technical identifiers, code symbols, and domain-specific terminology unless correction is obviously required.

Style instructions should be composed cleanly.

Example:

```text
Base behavior:
- Fix punctuation and grammar.
- Remove obvious filler.
- Preserve meaning.
- Do not answer the user's message.
- Return only the transformed text.

Selected style:
Professional
- Be concise.
- Use natural business language.
- Avoid unnecessary formality.
```

The LLM should return **only the rewritten text**, not commentary.

---

# 16. Important edge cases

The implementation plan must explicitly address these.

---

## Input/selection

- caret at beginning;
- caret in middle;
- caret at end;
- selected text replacement;
- empty field;
- field with existing multiline content;
- readonly input;
- disabled input;
- password input;
- input that disappears during processing;
- focus changes during processing.

---

## Contenteditable

- collapsed range;
- selected range;
- nested formatting elements;
- editor rerenders;
- range becomes invalid;
- editor rejects dispatched events.

---

## Recording

- shortcut pressed twice quickly;
- shortcut pressed repeatedly;
- stop immediately after start;
- no speech;
- very short speech;
- microphone permission denied;
- microphone disconnected;
- recorder throws;
- service-worker suspension concerns.

---

## Provider/API

- no API key;
- invalid API key;
- 401/403;
- 429;
- 5xx;
- offline;
- timeout;
- invalid JSON;
- empty STT result;
- LLM returns empty text;
- LLM returns markdown unexpectedly;
- STT succeeds but LLM fails.

---

## Clipboard

- no editable target;
- clipboard write denied/fails;
- result already inserted;
- ensure clipboard fallback does not cause duplicate insertion.

---

## Navigation

- user changes tab while processing;
- page reloads;
- SPA route change;
- active tab changes;
- original tab closes.

Define expected behavior. A safe fallback is preferable to cleverness.

---

# 17. Recommended acceptance criteria

The product is considered ready when all P0 acceptance tests pass.

---

## Core acceptance test A

1. Load extension unpacked.
2. Configure provider keys.
3. Open a simple webpage.
4. Focus a textarea.
5. Put caret in the middle of existing text.
6. Press shortcut.
7. Speak.
8. Press shortcut.
9. Improved text appears exactly at original caret.
10. Surrounding text remains intact.

---

## Core acceptance test B

1. Select existing text.
2. Dictate replacement.
3. Selected text is replaced by the result.

---

## Core acceptance test C

1. Click a non-editable part of the page.
2. Dictate.
3. Result is copied to clipboard.
4. User receives clear feedback.

---

## Core acceptance test D

1. Start dictation from an editable field.
2. Stop recording.
3. Click a different input while processing.
4. Result must not be inserted into the newly focused field.

---

## Core acceptance test E

1. Configure valid STT.
2. Break/disable LLM credentials.
3. Dictate.
4. Raw STT transcript remains recoverable.
5. No spoken content is silently lost.

---

## Core acceptance test F

1. Remove STT API key.
2. Trigger dictation.
3. User gets a useful configuration error.
4. No cryptic stack trace is shown.

---

## Core acceptance test G

1. Deny microphone permission.
2. Trigger dictation.
3. User sees a clear permission-related error.
4. Extension returns to a usable idle state.

---

## Core acceptance test H

1. Test `input`.
2. Test `textarea`.
3. Test basic `contenteditable`.
4. Verify expected insertion or documented safe fallback.

---

# 18. Manual test targets

At minimum test:

```text
Local/simple HTML test page
Chrome New Tab or ordinary non-editable webpage
Gmail compose
LinkedIn post/message editor
One React-based input
One basic contenteditable
```

If a complex editor is unsupported, clipboard fallback is acceptable if documented.

---

# 19. Suggested implementation order

Do not begin with UI polish.

Build vertically.

---

## Phase 1 — Skeleton

- Manifest V3.
- Service worker.
- Content script.
- Options/settings persistence.
- Keyboard command.
- Basic messaging.

Goal:

```text
Shortcut reliably reaches the extension architecture.
```

---

## Phase 2 — Recording

- permission flow;
- recorder;
- start/stop;
- resource cleanup;
- state transitions.

Goal:

```text
Shortcut → record → stop → obtain audio blob.
```

---

## Phase 3 — STT

- one provider;
- provider abstraction;
- normalized errors;
- empty-transcript handling.

Goal:

```text
Audio → raw transcript.
```

---

## Phase 4 — LLM

- prompt builder;
- built-in styles;
- one provider;
- raw fallback.

Goal:

```text
Raw transcript → polished text.
```

---

## Phase 5 — Insertion

- capture target;
- input;
- textarea;
- selection replacement;
- caret restoration;
- contenteditable;
- clipboard fallback.

Goal:

```text
Polished text lands safely where intended.
```

At this point the complete assignment flow should work.

---

## Phase 6 — Overlay and settings polish

- listening state;
- transcribing;
- improving;
- success;
- copied;
- error;
- API key UX;
- style selection.

---

## Phase 7 — P1 differentiation

Only now consider:

- custom styles;
- recent result;
- retry;
- richer editor support;
- popup polish.

---

## Phase 8 — Hardening

- race conditions;
- service-worker lifecycle;
- detached DOM targets;
- network failures;
- repeated shortcuts;
- cleanup;
- console errors;
- accessibility;
- manual test matrix.

---

## Phase 9 — README and submission

- clean install verification;
- clean clone verification;
- screenshots/GIF;
- architecture description;
- limitations;
- troubleshooting.

---

# 20. Five-day execution plan

Heavy AI assistance is expected, but architecture and debugging still require deliberate effort.

---

## Day 1 — Architecture + extension skeleton + recording

Deliverables:

- final architecture decision;
- manifest;
- build system;
- service worker/content script communication;
- keyboard shortcut;
- microphone permission path;
- recording start/stop;
- basic state model.

End-of-day goal:

> Press shortcut and successfully capture an audio blob.

---

## Day 2 — Complete backend processing flow

Deliverables:

- STT integration;
- LLM integration;
- prompt builder;
- built-in styles;
- settings/API keys;
- normalized provider errors.

End-of-day goal:

> Speak and receive a final improved string reliably.

---

## Day 3 — DOM insertion correctness

Deliverables:

- capture target;
- input insertion;
- textarea insertion;
- selected-text replacement;
- caret preservation;
- contenteditable support;
- clipboard fallback;
- changed-focus safety.

End-of-day goal:

> Full shortcut → speak → improved text → correct insertion workflow works end to end.

This is the most important milestone.

---

## Day 4 — Product polish

Deliverables:

- polished overlay;
- error UX;
- custom styles if time permits;
- recent result if time permits;
- popup/options polish;
- richer-editor fixes;
- focused tests.

End-of-day goal:

> The extension feels intentional rather than like a prototype.

---

## Day 5 — Hardening + submission

Do **not** spend Day 5 building large new features.

Deliverables:

- test across real sites;
- fix races;
- fix lifecycle bugs;
- test clean install;
- remove console noise;
- cleanup code;
- README;
- screenshots/GIF;
- limitations;
- test matrix.

End-of-day goal:

> Reviewer can clone, configure, build, load, and use the product without assistance.

---

# 21. What to prioritize when time is running out

Use this exact order.

```text
1. Shortcut reliability
2. Recording reliability
3. STT reliability
4. LLM reliability
5. Correct input/textarea insertion
6. Cursor/selection preservation
7. Clipboard fallback
8. contenteditable
9. User-visible state
10. Error recovery
11. Built-in styles
12. README
13. Custom styles
14. Rich editor improvements
15. Recent result
16. Extra visual polish
17. Streaming/silence detection/etc.
```

If a lower item threatens a higher item, remove the lower item.

---

# 22. Definition of done

The project is done when the following experience is dependable:

> On a normal webpage, the user can click where they want text, press one shortcut, speak naturally, press the shortcut again, and shortly afterward polished text appears exactly where their cursor was. The user does not need to interact with the popup during normal use. If insertion is not possible, the text is copied to the clipboard. If a provider fails, useful text is not silently lost. Setup is completely documented.

This matters more than feature count.

---

# 23. Instructions for the AI coding agent

Before implementing, produce an architecture/design proposal.

The proposal must include:

1. **Chosen stack**
   - JS or TypeScript;
   - bundler/build system;
   - testing framework;
   - styling approach.

2. **Manifest design**
   - permissions;
   - host permissions;
   - commands;
   - service worker;
   - content scripts;
   - options/popup/offscreen declarations.

3. **Execution contexts**
   - what runs in service worker;
   - what runs in content script;
   - what runs in offscreen document if used;
   - why.

4. **Audio design**
   - permission lifecycle;
   - MediaRecorder lifecycle;
   - audio format;
   - cleanup.

5. **Messaging design**
   - message types;
   - sender/receiver;
   - request/session IDs;
   - failure behavior.

6. **Session state machine**
   - all states;
   - valid transitions;
   - cancellation/repeated-command handling.

7. **Target capture and insertion design**
   - input;
   - textarea;
   - contenteditable;
   - selections;
   - changed focus;
   - detached targets;
   - event dispatching.

8. **STT provider abstraction**
   - interface;
   - chosen provider;
   - error normalization.

9. **LLM provider abstraction**
   - interface;
   - prompt construction;
   - style injection;
   - fallback behavior.

10. **Storage model**
    - provider keys;
    - settings;
    - built-in/custom styles;
    - recent result if implemented.

11. **UI surfaces**
    - overlay;
    - popup;
    - options;
    - state synchronization.

12. **Security/privacy**
    - minimal permissions;
    - key storage;
    - provider data flow.

13. **Testing**
    - unit tests;
    - integration/manual scenarios;
    - browser compatibility matrix.

14. **Risks**
    - Manifest V3 service-worker lifecycle;
    - microphone access;
    - contenteditable;
    - framework-controlled inputs;
    - clipboard restrictions;
    - SPA rerenders;
    - tab navigation.

15. **Implementation sequence**
    - map tasks to P0/P1/P2;
    - preserve the five-day schedule;
    - explicitly identify features that should be dropped first if schedule slips.

After presenting the architecture, implement **P0 vertically before P1**.

Do not generate a huge framework-heavy codebase.

Prefer understandable code, narrow modules, explicit state, and reliable browser behavior.

---

# 24. Final engineering philosophy

The evaluator is likely to see many submissions that technically satisfy:

```text
record
→ transcribe
→ rewrite
→ insert
```

Differentiation should come from execution quality:

- text appears at the correct cursor;
- selection replacement works;
- focus changes do not cause accidental insertion;
- failures do not destroy the transcript;
- UI clearly communicates state;
- settings are easy to configure;
- permissions are deliberate;
- README works;
- architecture is understandable;
- the extension feels safe and predictable.

**Do not try to win by having the most features.**

Win by making the core interaction feel like a product that could actually ship.
