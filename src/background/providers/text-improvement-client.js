import { loadSettings, resolveRewriteStyle } from "../../shared/settings.js";
import { createGeminiCompatibilityStore } from "./gemini-compatibility.js";
import {
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODELS,
  GEMINI_REQUEST_SHAPES,
  improveTextWithGemini
} from "./gemini-improver.js";
import { createTextImprovementError } from "./text-improvement-errors.js";

// Maps the stored `llmProvider` setting to an implementation. Adding a provider
// means adding an entry here *and* to SUPPORTED_LLM_PROVIDERS in settings.js;
// see the matching note in speech-to-text-client.js.
const IMPROVERS = Object.freeze({
  gemini: improveTextWithGemini
});

export const IMPLEMENTED_LLM_PROVIDERS = Object.freeze(Object.keys(IMPROVERS));

/**
 * Background text-improvement facade.
 *
 * This client owns settings lookup, style resolution, provider selection, and
 * the raw-style bypass so the controller does not know provider details.
 */
export function createTextImprovementClient({
  storageArea = undefined,
  sessionStorageArea = undefined,
  fetchApi = globalThis.fetch?.bind(globalThis)
} = {}) {
  const compatibility = createGeminiCompatibilityStore({
    storageArea: sessionStorageArea,
    isSupported: isSupportedGeminiPair
  });

  return {
    improveText
  };

  /**
   * Improves transcript text using the configured default style.
   */
  async function improveText({ text, signal = null } = {}) {
    const settings = await loadTextImprovementSettings(storageArea);
    const style = resolveRewriteStyle(settings);

    if (style.id === "raw") {
      return {
        text,
        styleId: style.id,
        source: "raw-style",
        providerMeta: {
          provider: "none",
          bypassed: true
        }
      };
    }

    const improveWithProvider = IMPROVERS[settings.llmProvider];
    if (!improveWithProvider) {
      throw createTextImprovementError(
        "LLM_PROVIDER_UNSUPPORTED",
        `Text-improvement provider "${settings.llmProvider}" is not available in this build.`
      );
    }

    // Provider implementations normalize their own failures, so there is no
    // second normalization pass here.
    return {
      ...await improveWithProvider({
        text,
        style,
        settings,
        fetchApi,
        signal,
        compatibility
      }),
      source: "llm"
    };
  }
}

/**
 * Rejects a remembered pair that this build no longer offers.
 */
function isSupportedGeminiPair(model, requestShape) {
  return [DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS].includes(model)
    && GEMINI_REQUEST_SHAPES.includes(requestShape);
}

async function loadTextImprovementSettings(storageArea) {
  try {
    return await loadSettings(storageArea);
  } catch (error) {
    throw createTextImprovementError(
      "LLM_SETTINGS_UNAVAILABLE",
      "Text-improvement settings could not be loaded.",
      error
    );
  }
}
