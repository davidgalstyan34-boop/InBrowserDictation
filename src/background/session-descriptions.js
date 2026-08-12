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
