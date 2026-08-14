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
 * Describes Phase 5 insertion readiness without exposing dictated content.
 */
export function describeOutputTextState(outputText, warning = null) {
  const textLength = typeof outputText?.text === "string" ? outputText.text.length : 0;
  const suffix = textLength > 0 ? ` (${textLength} characters)` : "";

  if (warning) {
    return `Raw transcript preserved${suffix}; inserting fallback text.`;
  }

  if (outputText?.source === "raw-style") {
    return `Raw transcript ready${suffix}; inserting text.`;
  }

  return `Improved text ready${suffix}; inserting text.`;
}

/**
 * Describes final insertion or clipboard fallback without exposing text.
 */
export function describeInsertionState(insertion, warning = null) {
  const textLength = Number.isInteger(insertion?.textLength) ? insertion.textLength : 0;
  const suffix = textLength > 0 ? ` (${textLength} characters)` : "";
  const target = describeInsertionTarget(insertion);

  if (insertion?.method === "clipboard") {
    return warning
      ? `Raw transcript copied to clipboard${suffix}; improvement failed.`
      : `Copied to clipboard${suffix}; ${describeFallbackReason(insertion)}.`;
  }

  return warning
    ? `Raw transcript inserted into ${target}${suffix}; improvement failed.`
    : `Inserted into ${target}${suffix}.`;
}

/**
 * Describes the captured target summary without exposing DOM references.
 */
function describePreparedTarget(target) {
  const kind = target?.kind ?? "none";
  const descriptionActions = {
    none: () => "No editable target captured",
    blocked: () => target.reason
  };

  const action = descriptionActions[kind];
  return action ? action() : `${kind} target captured`;
}

function describeInsertionTarget(insertion) {
  const kind = insertion?.targetKind;
  if (kind === "input") {
    return "input";
  }

  if (kind === "textarea") {
    return "textarea";
  }

  if (kind === "contenteditable") {
    return "editor";
  }

  return "page target";
}

function describeFallbackReason(insertion) {
  const reason = insertion?.fallbackReason;
  const descriptions = {
    INSERTION_TARGET_MISSING: "no editable target was available",
    INSERTION_TARGET_STALE: "the captured target changed before insertion",
    INSERTION_TARGET_DETACHED: "the captured target was no longer attached",
    INSERTION_RANGE_MISSING: "the captured editor selection was unavailable",
    INSERTION_RANGE_STALE: "the captured editor selection changed"
  };

  return descriptions[reason] ?? "target insertion was unavailable";
}
