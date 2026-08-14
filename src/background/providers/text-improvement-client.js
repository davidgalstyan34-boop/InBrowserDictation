import { loadSettings, resolveRewriteStyle } from "../../shared/settings.js";
import { improveTextWithGemini } from "./gemini-improver.js";
import {
  createTextImprovementError,
  normalizeTextImprovementError
} from "./text-improvement-errors.js";

/**
 * Background text-improvement facade.
 *
 * This client owns settings lookup, style resolution, provider selection, and
 * the raw-style bypass so the controller does not know provider details.
 */
export function createTextImprovementClient({
  storageArea = undefined,
  fetchApi = globalThis.fetch?.bind(globalThis)
} = {}) {
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

    try {
      return {
        ...await improveTextWithGemini({
          text,
          style,
          settings,
          fetchApi,
          signal
        }),
        source: "llm"
      };
    } catch (error) {
      throw normalizeTextImprovementError(error);
    }
  }
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
