/**
 * Redacts the private background session for UI and diagnostics callers.
 *
 * Transcript text, improved text, and audio data URLs stay inside the service
 * worker. Public views expose only metadata needed by overlays, options, and
 * future popup surfaces.
 */

/**
 * Produces the session shape that UI or diagnostics can request.
 */
export function toPublicSession(session) {
  return {
    id: session.id,
    status: session.status,
    tabId: session.tabId,
    startedAt: session.startedAt,
    target: session.target,
    recording: toPublicRecording(session.recording),
    audio: toPublicAudio(session.audio),
    transcription: toPublicTranscription(session.transcription),
    improvement: toPublicImprovement(session.improvement),
    outputText: toPublicOutputText(session.outputText),
    insertion: toPublicInsertion(session.insertion),
    updatedAt: session.updatedAt,
    warning: session.warning,
    error: session.error
  };
}

function toPublicRecording(recording) {
  if (!recording) {
    return null;
  }

  return {
    startedAt: Number.isFinite(recording.startedAt) ? recording.startedAt : null,
    tabId: Number.isInteger(recording.tabId) ? recording.tabId : null,
    mimeType: typeof recording.mimeType === "string" ? recording.mimeType : ""
  };
}

function toPublicAudio(audio) {
  if (!audio) {
    return null;
  }

  return {
    mimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes,
    durationMs: audio.durationMs,
    capturedAt: audio.capturedAt
  };
}

function toPublicTranscription(transcription) {
  if (!transcription) {
    return null;
  }

  return {
    textLength: typeof transcription.transcript === "string" ? transcription.transcript.length : 0,
    providerMeta: toPublicProviderMeta(transcription.providerMeta)
  };
}

function toPublicImprovement(improvement) {
  if (!improvement) {
    return null;
  }

  return {
    textLength: typeof improvement.text === "string" ? improvement.text.length : 0,
    source: improvement.source ?? "llm",
    styleId: improvement.styleId ?? null,
    providerMeta: toPublicProviderMeta(improvement.providerMeta)
  };
}

function toPublicOutputText(outputText) {
  if (!outputText) {
    return null;
  }

  return {
    textLength: typeof outputText.text === "string" ? outputText.text.length : 0,
    source: outputText.source,
    styleId: outputText.styleId,
    providerMeta: toPublicProviderMeta(outputText.providerMeta)
  };
}

function toPublicProviderMeta(providerMeta) {
  if (!providerMeta || typeof providerMeta !== "object") {
    return null;
  }

  const provider = typeof providerMeta.provider === "string" ? providerMeta.provider : null;
  if (!provider) {
    return null;
  }

  const metaByProvider = {
    deepgram: () => compactObject({
      provider,
      model: stringOrUndefined(providerMeta.model),
      requestId: stringOrUndefined(providerMeta.requestId),
      durationSec: numberOrUndefined(providerMeta.durationSec),
      confidence: numberOrUndefined(providerMeta.confidence)
    }),
    gemini: () => compactObject({
      provider,
      model: stringOrUndefined(providerMeta.model),
      responseId: stringOrUndefined(providerMeta.responseId),
      finishReason: stringOrUndefined(providerMeta.finishReason)
    }),
    none: () => compactObject({
      provider,
      bypassed: providerMeta.bypassed === true ? true : undefined
    })
  };

  return metaByProvider[provider]?.() ?? { provider };
}

function toPublicInsertion(insertion) {
  if (!insertion) {
    return null;
  }

  return {
    method: insertion.method,
    strategy: insertion.strategy,
    targetKind: insertion.targetKind,
    textLength: insertion.textLength,
    fallbackReason: insertion.fallbackReason
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function stringOrUndefined(value) {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined;
}
