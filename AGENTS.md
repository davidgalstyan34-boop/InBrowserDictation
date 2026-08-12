# AGENTS.md

## Project Guidance

- Preserve the phase plan in `docs/architecture.md`; build vertical slices before polish.
- Keep code readable by naming lifecycle steps directly and isolating browser-context concerns.
- Keep JavaScript files small. Entrypoints should register events and delegate to focused modules, not accumulate orchestration, state, messaging, and API details in one script.
- Add module-level descriptions and method/function comments for non-trivial behavior so a reader can quickly understand ownership, lifecycle, inputs, outputs, and browser-context constraints.
- Add comments only where they explain non-obvious Chrome extension constraints, async lifecycle ordering, or stale-session safety.
- Keep the service worker as the authoritative session owner.
- Keep the service worker entrypoint thin; put session orchestration, offscreen communication, content-tab messaging, and provider calls behind delegated background modules.
- Keep DOM target capture and insertion in content scripts.
- Keep microphone and `MediaRecorder` work in the offscreen document.
- Prefer small shared modules with pure helpers and focused Node tests when logic does not require Chrome APIs.
- Do not log secrets, transcript text, or audio payloads.
- Add Chrome permissions only when the current phase needs them, and document each new permission in `README.md` or `docs/architecture.md`.
- Make new modules easy to extend for later STT, LLM, insertion, and clipboard phases without coupling those concerns to recording.
