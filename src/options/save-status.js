/**
 * Updates the options-page save status live region.
 */
export function showSaveStatus(element, message, tone = "default") {
  element.dataset.tone = tone;
  element.textContent = message;
}

export function clearSaveStatus(element) {
  showSaveStatus(element, "");
}
