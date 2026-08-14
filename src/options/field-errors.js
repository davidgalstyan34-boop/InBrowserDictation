/**
 * Presents validation errors beside their matching options-page controls.
 */
export function createFieldErrorPresenter(elements) {
  const controls = {
    sttApiKey: elements.sttApiKey,
    llmApiKey: elements.llmApiKey,
    defaultStyleId: elements.defaultStyle
  };
  const errors = {
    sttApiKey: elements.sttApiKeyError,
    llmApiKey: elements.llmApiKeyError,
    defaultStyleId: elements.defaultStyleError
  };

  return {
    show,
    clear,
    clearAll
  };

  function show(nextErrors) {
    for (const [name, message] of Object.entries(nextErrors)) {
      set(name, message);
    }
  }

  function clear(name) {
    set(name, "");
  }

  function clearAll() {
    for (const name of Object.keys(errors)) {
      clear(name);
    }
  }

  function set(name, message) {
    const control = controls[name];
    const error = errors[name];

    if (!control || !error) {
      return;
    }

    control.setAttribute("aria-invalid", message ? "true" : "false");
    error.textContent = message || "";
  }
}
