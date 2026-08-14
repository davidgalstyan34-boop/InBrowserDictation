import { loadSettings } from "../../shared/settings.js";
import { audioPayloadToBlob } from "./audio-payload.js";
import {
  createSpeechToTextError,
  normalizeSpeechToTextError
} from "./speech-to-text-errors.js";
import {
  transcribeWithDeepgram
} from "./deepgram-transcriber.js";

/**
 * Background speech-to-text facade.
 *
 * The controller depends on this provider-neutral client so STT settings,
 * provider selection, and provider-specific request details do not leak into
 * dictation lifecycle code.
 */
export function createSpeechToTextClient({
  storageArea = undefined,
  fetchApi = globalThis.fetch?.bind(globalThis)
} = {}) {
  return {
    transcribe
  };

  /**
   * Loads user settings and transcribes the recorded audio payload.
   */
  async function transcribe({ audio, signal = null } = {}) {
    const settings = await loadSpeechToTextSettings(storageArea);

    try {
      const audioBlob = audioPayloadToBlob(audio);

      return await transcribeWithDeepgram({
        audioBlob,
        mimeType: audio?.mimeType ?? audioBlob.type,
        settings,
        fetchApi,
        signal
      });
    } catch (error) {
      throw normalizeSpeechToTextError(error);
    }
  }
}

async function loadSpeechToTextSettings(storageArea) {
  try {
    return await loadSettings(storageArea);
  } catch (error) {
    throw createSpeechToTextError(
      "STT_SETTINGS_UNAVAILABLE",
      "Speech-to-text settings could not be loaded.",
      error
    );
  }
}
