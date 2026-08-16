const COMPATIBILITY_STORAGE_KEY = "geminiCompatibility";

/**
 * Remembers which Gemini model and request shape last worked.
 *
 * The provider probes a ladder of models and request-body shapes to survive
 * differences between API projects and REST surfaces. Without a memory, every
 * dictation re-walks that ladder from the top, so an account whose primary
 * model is unavailable pays the failed round-trips forever, inside the same
 * timeout budget as the request that actually matters.
 *
 * `chrome.storage.session` is the right scope: the answer should outlive
 * service-worker suspension but not the browser session, because model
 * availability can change under the account.
 */
export function createGeminiCompatibilityStore({
  storageArea = getDefaultSessionStorageArea(),
  isSupported = () => true
} = {}) {
  let memoryValue = null;

  return {
    load,
    save
  };

  async function load() {
    if (memoryValue) {
      return memoryValue;
    }

    if (!storageArea) {
      return null;
    }

    try {
      const stored = await storageArea.get({ [COMPATIBILITY_STORAGE_KEY]: null });
      memoryValue = normalize(stored?.[COMPATIBILITY_STORAGE_KEY], isSupported);
    } catch {
      return null;
    }

    return memoryValue;
  }

  async function save(value) {
    const normalized = normalize(value, isSupported);
    if (!normalized || isSamePair(normalized, memoryValue)) {
      return memoryValue;
    }

    memoryValue = normalized;

    try {
      await storageArea?.set({ [COMPATIBILITY_STORAGE_KEY]: normalized });
    } catch {
      // A failed write only costs the next request one extra probe.
    }

    return memoryValue;
  }
}

function normalize(value, isSupported) {
  if (typeof value?.model !== "string" || typeof value?.requestShape !== "string") {
    return null;
  }

  if (!isSupported(value.model, value.requestShape)) {
    return null;
  }

  return {
    model: value.model,
    requestShape: value.requestShape
  };
}

function isSamePair(left, right) {
  return left.model === right?.model && left.requestShape === right?.requestShape;
}

function getDefaultSessionStorageArea() {
  return globalThis.chrome?.storage?.session ?? null;
}
