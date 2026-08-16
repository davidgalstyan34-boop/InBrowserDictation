/**
 * Builds short overlay copy from the current background session.
 */
export function describeRecordingState(session) {
  const targetDetail = describePreparedTarget(session.target);
  return targetDetail
    ? `${targetDetail}; microphone is active`
    : "Microphone is active";
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
 * Describes insertion readiness without exposing dictated content.
 */
export function describeOutputTextState(outputText, warning = null) {
  const textLength = typeof outputText?.text === "string" ? outputText.text.length : 0;
  const suffix = textLength > 0 ? ` (${textLength} characters)` : "";

  if (warning) {
    return `${describeImprovementWarning(warning)}; inserting raw transcript${suffix}.`;
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
      ? `Raw transcript copied to clipboard${suffix}; ${describeImprovementWarning(warning)}.`
      : `Copied to clipboard${suffix}; ${describeFallbackReason(insertion)}.`;
  }

  return warning
    ? `Raw transcript inserted into ${target}${suffix}; ${describeImprovementWarning(warning)}.`
    : `Inserted into ${target}${suffix}.`;
}

/**
 * Describes the captured target, or returns null when there is nothing to say.
 *
 * Returning null rather than a sentence keeps callers from having to compare
 * against copy they do not own. A blocked target never reaches a recording
 * session, because those fail before the recorder starts.
 */
function describePreparedTarget(target) {
  const kind = target?.kind;
  return kind && kind !== "none" ? `${kind} target captured` : null;
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

function describeImprovementWarning(warning) {
  const descriptions = {
    LLM_API_KEY_MISSING: "Gemini key missing",
    LLM_AUTH_FAILED: "Gemini key rejected",
    LLM_RATE_LIMITED: "Gemini rate limit reached",
    LLM_MODEL_UNAVAILABLE: "Gemini model unavailable",
    LLM_TIMEOUT: "Gemini request timed out",
    LLM_CANCELLED: "Gemini request cancelled",
    LLM_PROVIDER_REJECTED_TEXT: "Gemini rejected the transcript",
    LLM_PROVIDER_UNAVAILABLE: "Gemini temporarily unavailable",
    LLM_INVALID_RESPONSE: "Gemini returned an unreadable response",
    LLM_EMPTY_TEXT: "Gemini returned no improved text",
    LLM_NETWORK_FAILED: "Gemini request failed",
    LLM_PROVIDER_FAILED: "Gemini improvement failed",
    LLM_FETCH_UNAVAILABLE: "Gemini requests are unavailable",
    LLM_SETTINGS_UNAVAILABLE: "Gemini settings unavailable",
    LLM_TEXT_MISSING: "No transcript was available for Gemini"
  };

  return descriptions[warning?.code] ?? "Text improvement failed";
}
