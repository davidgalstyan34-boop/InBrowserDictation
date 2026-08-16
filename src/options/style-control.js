import {
  BUILT_IN_STYLES,
  getRewriteStyles,
  normalizeSettings
} from "../shared/settings.js";

/**
 * Owns rewrite style select rendering and explanatory copy.
 */
export function populateStyleOptions(selectElement, settingsValue = {}) {
  const settings = normalizeSettings(settingsValue);
  selectElement.textContent = "";
  const documentRef = selectElement.ownerDocument;

  for (const style of BUILT_IN_STYLES) {
    const option = documentRef.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    selectElement.append(option);
  }

  if (settings.customStyles.length === 0) {
    return;
  }

  const group = documentRef.createElement("optgroup");
  group.label = "Custom";

  for (const style of settings.customStyles) {
    const option = documentRef.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    group.append(option);
  }

  selectElement.append(group);
}

export function updateStyleDescription(elements, styleId, settingsValue = {}) {
  const selected = getRewriteStyles(settingsValue).find((style) => style.id === styleId);
  elements.styleDescription.textContent = selected?.description ?? "";
  elements.styleProcessingNote.textContent = selected?.id === "raw"
    ? "Gemini is skipped for Raw; only Deepgram is used."
    : "Gemini improves text with this style after Deepgram transcription.";
}
