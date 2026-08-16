import { loadSettings, saveSettings, validateSettings } from "../shared/settings.js";
import { syncConfigurationFeedback, getRequiredConfigurationErrors } from "./configuration-feedback.js";
import { createCustomStyleController } from "./custom-style-control.js";
import { createFieldErrorPresenter } from "./field-errors.js";
import { getOptionsElements } from "./options-elements.js";
import { readFormSettings, renderSettings } from "./settings-form.js";
import { clearSaveStatus, showSaveStatus } from "./save-status.js";
import { registerSecretVisibilityToggles } from "./secret-fields.js";
import { populateStyleOptions, updateStyleDescription } from "./style-control.js";

// Thin options-page entrypoint. Focused modules own field rendering, validation
// display, secret visibility, and style-dependent configuration feedback.
const elements = getOptionsElements();
const fieldErrors = createFieldErrorPresenter(elements);
const customStyles = createCustomStyleController(elements, {
  onChange: handleCustomStylesChange
});

void initializeOptionsPage();

/**
 * Loads current settings, renders the form, and registers page events.
 */
async function initializeOptionsPage() {
  populateStyleOptions(elements.defaultStyle);
  registerEvents();

  try {
    const settings = await loadSettings();
    renderLoadedSettings(settings);
  } catch (error) {
    console.warn("[In-Browser Dictation] Could not load settings.", error);
    showSaveStatus(
      elements.saveStatus,
      "Settings could not be loaded. Reload the options page and try again.",
      "error"
    );
  }
}

function registerEvents() {
  elements.defaultStyle.addEventListener("change", handleStyleChange);

  for (const input of [elements.sttApiKey, elements.llmApiKey]) {
    input.addEventListener("input", () => {
      fieldErrors.clear(input.name);
      syncConfigurationFeedback(elements, readCurrentSettings());
      clearSaveStatus(elements.saveStatus);
    });
  }

  registerSecretVisibilityToggles(elements.secretToggleButtons);

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleSave();
  });
}

function renderLoadedSettings(settings) {
  customStyles.setStyles(settings.customStyles);
  renderSettings(elements, settings);
  refreshStyleOptions(settings.defaultStyleId);
  updateStyleDescription(elements, elements.defaultStyle.value, readCurrentSettings());
  fieldErrors.clearAll();
  customStyles.showError("");
  syncConfigurationFeedback(elements, readCurrentSettings());
}

function handleStyleChange() {
  updateStyleDescription(elements, elements.defaultStyle.value, readCurrentSettings());
  fieldErrors.clear("defaultStyleId");
  fieldErrors.clear("llmApiKey");
  syncConfigurationFeedback(elements, readCurrentSettings());
  clearSaveStatus(elements.saveStatus);
}

function handleCustomStylesChange() {
  refreshStyleOptions(elements.defaultStyle.value);
  updateStyleDescription(elements, elements.defaultStyle.value, readCurrentSettings());
  fieldErrors.clear("defaultStyleId");
  customStyles.showError("");
  syncConfigurationFeedback(elements, readCurrentSettings());
  clearSaveStatus(elements.saveStatus);
}

async function handleSave() {
  fieldErrors.clearAll();
  customStyles.showError("");

  const validation = validateSettings(readCurrentSettings());
  if (!validation.ok) {
    fieldErrors.show(validation.errors);
    showCustomStyleValidationError(validation.errors);
    showSaveStatus(elements.saveStatus, "Check the highlighted settings.", "error");
    return;
  }

  const configurationErrors = getRequiredConfigurationErrors(validation.settings);
  if (Object.keys(configurationErrors).length > 0) {
    fieldErrors.show(configurationErrors);
    syncConfigurationFeedback(elements, validation.settings);
    showSaveStatus(elements.saveStatus, "Complete required settings before saving.", "error");
    return;
  }

  try {
    const saveResult = await saveSettings(validation.settings);
    if (!saveResult.ok) {
      fieldErrors.show(saveResult.errors);
      showCustomStyleValidationError(saveResult.errors);
      showSaveStatus(elements.saveStatus, "Check the highlighted settings.", "error");
      return;
    }

    customStyles.setStyles(saveResult.settings.customStyles);
    refreshStyleOptions(saveResult.settings.defaultStyleId);
    syncConfigurationFeedback(elements, saveResult.settings);
    showSaveStatus(elements.saveStatus, "Settings saved.", "success");
  } catch (error) {
    console.warn("[In-Browser Dictation] Could not save settings.", error);
    showSaveStatus(
      elements.saveStatus,
      "Settings could not be saved. Check extension storage permissions.",
      "error"
    );
  }
}

function readCurrentSettings() {
  return readFormSettings(elements, customStyles.getStyles());
}

function refreshStyleOptions(preferredStyleId) {
  const settings = readCurrentSettings();
  const selectedStyleId = preferredStyleId || settings.defaultStyleId || "default";

  populateStyleOptions(elements.defaultStyle, settings);
  elements.defaultStyle.value = optionExists(elements.defaultStyle, selectedStyleId)
    ? selectedStyleId
    : "default";
}

function optionExists(selectElement, value) {
  return [...selectElement.options].some((option) => option.value === value);
}

function showCustomStyleValidationError(errors) {
  const customStyleError = Object.entries(errors)
    .find(([name]) => name.startsWith("customStyles."))?.[1];

  if (customStyleError) {
    customStyles.showError(customStyleError);
  }
}
