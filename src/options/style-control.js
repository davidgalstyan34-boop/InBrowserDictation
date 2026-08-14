import { BUILT_IN_STYLES } from "../shared/settings.js";

/**
 * Owns built-in style select rendering and explanatory copy.
 */
export function populateStyleOptions(selectElement) {
  selectElement.textContent = "";
  const documentRef = selectElement.ownerDocument;

  for (const style of BUILT_IN_STYLES) {
    const option = documentRef.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    selectElement.append(option);
  }
}

export function updateStyleDescription(elements, styleId) {
  const selected = BUILT_IN_STYLES.find((style) => style.id === styleId);
  elements.styleDescription.textContent = selected?.description ?? "";
  elements.styleProcessingNote.textContent = selected?.id === "raw"
    ? "Gemini is skipped for Raw; only Deepgram is used."
    : "Gemini improves text with this style after Deepgram transcription.";
}
