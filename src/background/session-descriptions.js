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
    ? `${provider} transcript captured (${textLength} characters). Text improvement is next.`
    : `${provider} transcript captured. Text improvement is next.`;
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
