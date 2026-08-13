/**
 * Builds short overlay copy from the current background session.
 */
export function describeRecordingState(session) {
  const targetDetail = describePreparedTarget(session.target);
  return targetDetail === "No editable target captured"
    ? "Microphone is active"
    : `${targetDetail}; microphone is active`;
}

/**
 * Describes STT completion without exposing transcript text in page UI.
 */
export function describeTranscriptionState(transcription) {
  const textLength = typeof transcription?.transcript === "string"
    ? transcription.transcript.length
    : 0;
  const provider = transcription?.providerMeta?.provider === "deepgram"
    ? "Deepgram"
    : "STT";

  return textLength > 0
    ? `${provider} transcript captured (${textLength} characters)`
    : `${provider} transcript captured`;
}

/**
 * Describes Phase 4 text readiness without exposing dictated content.
 */
export function describeOutputTextState(outputText, warning = null) {
  const textLength = typeof outputText?.text === "string" ? outputText.text.length : 0;
  const suffix = textLength > 0 ? ` (${textLength} characters)` : "";

  if (warning) {
    return `Raw transcript preserved${suffix}; improvement failed.`;
  }

  if (outputText?.source === "raw-style") {
    return `Raw transcript ready${suffix}. Insertion is next.`;
  }

  return `Improved text ready${suffix}. Insertion is next.`;
}

/**
 * Describes the captured target summary without exposing DOM references.
 */
export function describePreparedTarget(target) {
  const kind = target?.kind ?? "none";
  const descriptionActions = {
    none: () => "No editable target captured",
    blocked: () => target.reason
  };

  const action = descriptionActions[kind];
  return action ? action() : `${kind} target captured`;
}
