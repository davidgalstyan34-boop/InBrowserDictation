import { BUILT_IN_STYLES, loadSettings, saveSettings, validateSettings } from "../shared/settings.js";

// Options page controller for provider credentials and default rewrite style.
// It stays UI-only; validation and storage are delegated to shared/settings.js.
const form = document.querySelector("#settings-form");
const sttProvider = document.querySelector("#stt-provider");
const sttApiKey = document.querySelector("#stt-api-key");
const llmProvider = document.querySelector("#llm-provider");
const llmApiKey = document.querySelector("#llm-api-key");
const defaultStyle = document.querySelector("#default-style");
const styleDescription = document.querySelector("#style-description");
const saveStatus = document.querySelector("#save-status");

void initializeOptionsPage();

/**
 * Loads current settings, renders the form, and registers page events.
 */
async function initializeOptionsPage() {
  populateStyleOptions();

  try {
    const settings = await loadSettings();
    renderSettings(settings);
  } catch (error) {
    console.warn("[In-Browser Dictation] Could not load settings.", error);
    showSaveStatus("Settings could not be loaded. Reload the options page and try again.");
  }

  defaultStyle.addEventListener("change", () => {
    updateStyleDescription(defaultStyle.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleSave();
  });
}

/**
 * Populates the style select from code-defined styles.
 */
function populateStyleOptions() {
  for (const style of BUILT_IN_STYLES) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    defaultStyle.append(option);
  }
}

/**
 * Copies persisted settings into form controls.
 */
function renderSettings(settings) {
  sttProvider.value = settings.sttProvider;
  sttApiKey.value = settings.sttApiKey;
  llmProvider.value = settings.llmProvider;
  llmApiKey.value = settings.llmApiKey;
  defaultStyle.value = settings.defaultStyleId;
  updateStyleDescription(settings.defaultStyleId);
}

/**
 * Validates and saves the form values.
 */
async function handleSave() {
  const nextSettings = {
    sttProvider: sttProvider.value,
    sttApiKey: sttApiKey.value.trim(),
    llmProvider: llmProvider.value,
    llmApiKey: llmApiKey.value.trim(),
    defaultStyleId: defaultStyle.value,
    customStyles: []
  };

  const validation = validateSettings(nextSettings);
  if (!validation.ok) {
    showSaveStatus(Object.values(validation.errors)[0] || "Check settings.");
    return;
  }

  try {
    await saveSettings(nextSettings);
    showSaveStatus("Settings saved.");
  } catch (error) {
    console.warn("[In-Browser Dictation] Could not save settings.", error);
    showSaveStatus("Settings could not be saved. Check extension storage permissions.");
  }
}

function updateStyleDescription(styleId) {
  const selected = BUILT_IN_STYLES.find((style) => style.id === styleId);
  styleDescription.textContent = selected?.description ?? "";
}

function showSaveStatus(message) {
  saveStatus.textContent = message;
}
