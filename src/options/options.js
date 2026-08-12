import { BUILT_IN_STYLES, loadSettings, saveSettings, validateSettings } from "../shared/settings.js";

const form = document.querySelector("#settings-form");
const sttProvider = document.querySelector("#stt-provider");
const sttApiKey = document.querySelector("#stt-api-key");
const llmProvider = document.querySelector("#llm-provider");
const llmApiKey = document.querySelector("#llm-api-key");
const defaultStyle = document.querySelector("#default-style");
const styleDescription = document.querySelector("#style-description");
const saveStatus = document.querySelector("#save-status");

initializeOptionsPage();

async function initializeOptionsPage() {
  populateStyleOptions();
  const settings = await loadSettings();
  renderSettings(settings);

  defaultStyle.addEventListener("change", () => {
    updateStyleDescription(defaultStyle.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleSave();
  });
}

function populateStyleOptions() {
  for (const style of BUILT_IN_STYLES) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    defaultStyle.append(option);
  }
}

function renderSettings(settings) {
  sttProvider.value = settings.sttProvider;
  sttApiKey.value = settings.sttApiKey;
  llmProvider.value = settings.llmProvider;
  llmApiKey.value = settings.llmApiKey;
  defaultStyle.value = settings.defaultStyleId;
  updateStyleDescription(settings.defaultStyleId);
}

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
    saveStatus.textContent = Object.values(validation.errors)[0] || "Check settings.";
    return;
  }

  await saveSettings(nextSettings);
  saveStatus.textContent = "Settings saved.";
}

function updateStyleDescription(styleId) {
  const selected = BUILT_IN_STYLES.find((style) => style.id === styleId);
  styleDescription.textContent = selected?.description ?? "";
}
