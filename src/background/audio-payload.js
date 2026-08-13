import { createSpeechToTextError } from "./speech-to-text-errors.js";

/**
 * Converts the recorder's JSON-safe data URL back to a Blob for provider fetch.
 */
export function audioPayloadToBlob(audio) {
  if (!audio?.dataUrl || typeof audio.dataUrl !== "string") {
    throw createSpeechToTextError(
      "STT_AUDIO_MISSING",
      "No recorded audio is available for transcription."
    );
  }

  const parsed = parseDataUrl(audio.dataUrl);
  return new Blob([parsed.bytes], {
    type: audio.mimeType || parsed.mimeType || "application/octet-stream"
  });
}

function parseDataUrl(dataUrl) {
  if (!dataUrl.toLowerCase().startsWith("data:")) {
    throw createSpeechToTextError(
      "STT_AUDIO_INVALID",
      "Recorded audio could not be decoded for transcription."
    );
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw createSpeechToTextError(
      "STT_AUDIO_INVALID",
      "Recorded audio could not be decoded for transcription."
    );
  }

  try {
    const metadata = dataUrl.slice("data:".length, commaIndex);
    const encodedData = dataUrl.slice(commaIndex + 1);
    const metadataParts = metadata.split(";").filter(Boolean);
    const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
    const mimeType = metadataParts
      .filter((part) => part.toLowerCase() !== "base64")
      .join(";");
    const binary = isBase64
      ? decodeBase64(encodedData)
      : decodeURIComponent(encodedData);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return {
      mimeType,
      bytes
    };
  } catch (error) {
    throw createSpeechToTextError(
      "STT_AUDIO_INVALID",
      "Recorded audio could not be decoded for transcription.",
      error
    );
  }
}

function decodeBase64(value) {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(value);
  }

  if (typeof globalThis.Buffer === "function") {
    return globalThis.Buffer.from(value, "base64").toString("binary");
  }

  throw new Error("No base64 decoder is available.");
}
