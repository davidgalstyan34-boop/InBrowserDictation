import { DictationStatus } from "../../shared/dictation-state.js";

const RECENT_RESULT_STORAGE_KEY = "recentResult";

/**
 * Stores only the latest successful dictation result for popup recovery.
 *
 * `chrome.storage.session` is temporary and service-worker-safe. Tests and
 * older browser contexts fall back to an in-memory copy.
 */
export function createRecentResultStore({
  storageArea = getDefaultSessionStorageArea(),
  now = () => Date.now()
} = {}) {
  let memoryResult = null;

  return {
    clear,
    load,
    save,
    saveFromSession
  };

  async function load() {
    if (!storageArea) {
      return memoryResult;
    }

    try {
      const stored = await storageArea.get({ [RECENT_RESULT_STORAGE_KEY]: null });
      memoryResult = normalizeRecentResult(stored?.[RECENT_RESULT_STORAGE_KEY]);
    } catch {
      return memoryResult;
    }

    return memoryResult;
  }

  async function save(value) {
    const result = normalizeRecentResult({
      ...value,
      capturedAt: Number.isFinite(value?.capturedAt) ? value.capturedAt : now()
    });

    memoryResult = result;

    if (storageArea) {
      await storageArea.set({ [RECENT_RESULT_STORAGE_KEY]: result });
    }

    return result;
  }

  async function saveFromSession(session) {
    const result = createRecentResultFromSession(session, now);
    if (!result) {
      return null;
    }

    return await save(result);
  }

  async function clear() {
    memoryResult = null;

    if (storageArea?.remove) {
      await storageArea.remove(RECENT_RESULT_STORAGE_KEY);
      return;
    }

    if (storageArea) {
      await storageArea.set({ [RECENT_RESULT_STORAGE_KEY]: null });
    }
  }
}

/**
 * Builds a recoverable record from a session that has produced final text.
 *
 * INSERTING counts as well as SUCCESS: insertion is the step most likely to
 * fail irrecoverably (detached target plus a clipboard write the browser
 * refuses), and that is exactly when the user needs the popup to still hold the
 * text. Waiting for SUCCESS would save a record only when it is least needed.
 */
export function createRecentResultFromSession(session, now = () => Date.now()) {
  if (!hasRecoverableOutput(session)) {
    return null;
  }

  return normalizeRecentResult({
    sessionId: session.id,
    rawTranscript: session.transcription?.transcript ?? "",
    finalText: session.outputText.text,
    outputSource: session.outputText.source,
    styleId: session.outputText.styleId,
    warning: session.warning,
    insertion: session.insertion,
    // The session tracks when it last changed; for a session that has produced
    // final text, that is when the result was completed.
    completedAt: session.updatedAt,
    capturedAt: now()
  });
}

function hasRecoverableOutput(session) {
  const producedFinalText = session?.status === DictationStatus.INSERTING
    || session?.status === DictationStatus.SUCCESS;

  return producedFinalText && Boolean(session.outputText?.text);
}

export function normalizeRecentResult(value) {
  if (!value || typeof value.finalText !== "string" || value.finalText.length === 0) {
    return null;
  }

  const rawTranscript = typeof value.rawTranscript === "string"
    ? value.rawTranscript
    : "";

  return {
    sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
    rawTranscript,
    rawTextLength: rawTranscript.length,
    finalText: value.finalText,
    finalTextLength: value.finalText.length,
    outputSource: typeof value.outputSource === "string" ? value.outputSource : "unknown",
    styleId: typeof value.styleId === "string" ? value.styleId : null,
    warning: value.warning ?? null,
    insertion: normalizeInsertion(value.insertion),
    completedAt: Number.isFinite(value.completedAt) ? value.completedAt : null,
    capturedAt: Number.isFinite(value.capturedAt) ? value.capturedAt : null
  };
}

function normalizeInsertion(insertion) {
  if (!insertion || typeof insertion !== "object") {
    return null;
  }

  return {
    method: typeof insertion.method === "string" ? insertion.method : "unknown",
    strategy: typeof insertion.strategy === "string" ? insertion.strategy : null,
    targetKind: typeof insertion.targetKind === "string" ? insertion.targetKind : null,
    textLength: Number.isInteger(insertion.textLength) ? insertion.textLength : 0,
    fallbackReason: typeof insertion.fallbackReason === "string" ? insertion.fallbackReason : null
  };
}

function getDefaultSessionStorageArea() {
  return globalThis.chrome?.storage?.session ?? null;
}
