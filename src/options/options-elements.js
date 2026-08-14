/**
 * Collects options-page DOM handles in one place.
 */
export function getOptionsElements(documentRef = document) {
  return {
    form: queryRequired(documentRef, "#settings-form"),
    sttProvider: queryRequired(documentRef, "#stt-provider"),
    sttApiKey: queryRequired(documentRef, "#stt-api-key"),
    sttApiKeyHelp: queryRequired(documentRef, "#stt-api-key-help"),
    sttApiKeyError: queryRequired(documentRef, "#stt-api-key-error"),
    sttKeyState: queryRequired(documentRef, "#stt-key-state"),
    llmProvider: queryRequired(documentRef, "#llm-provider"),
    llmApiKey: queryRequired(documentRef, "#llm-api-key"),
    llmApiKeyHelp: queryRequired(documentRef, "#llm-api-key-help"),
    llmApiKeyError: queryRequired(documentRef, "#llm-api-key-error"),
    llmKeyState: queryRequired(documentRef, "#llm-key-state"),
    defaultStyle: queryRequired(documentRef, "#default-style"),
    defaultStyleError: queryRequired(documentRef, "#default-style-error"),
    styleDescription: queryRequired(documentRef, "#style-description"),
    styleProcessingNote: queryRequired(documentRef, "#style-processing-note"),
    saveStatus: queryRequired(documentRef, "#save-status"),
    secretToggleButtons: [...documentRef.querySelectorAll("[data-toggle-secret]")]
  };
}

function queryRequired(documentRef, selector) {
  const element = documentRef.querySelector(selector);
  if (!element) {
    throw new Error(`Missing options page element: ${selector}`);
  }

  return element;
}
