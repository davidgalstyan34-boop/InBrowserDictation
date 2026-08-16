/**
 * Reads and renders the persisted options form values.
 */
export function readFormSettings(elements, customStyles = []) {
  return {
    sttProvider: elements.sttProvider.value,
    sttApiKey: elements.sttApiKey.value.trim(),
    llmProvider: elements.llmProvider.value,
    llmApiKey: elements.llmApiKey.value.trim(),
    defaultStyleId: elements.defaultStyle.value,
    customStyles
  };
}

export function renderSettings(elements, settings) {
  elements.sttProvider.value = settings.sttProvider;
  elements.sttApiKey.value = settings.sttApiKey;
  elements.llmProvider.value = settings.llmProvider;
  elements.llmApiKey.value = settings.llmApiKey;
  elements.defaultStyle.value = settings.defaultStyleId;
}
