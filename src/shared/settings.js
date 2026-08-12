/**
 * Built-in rewrite styles available before custom style management exists.
 *
 * Provider prompts are introduced in later phases; for now the options page
 * uses these records to present stable style IDs and descriptions.
 */
export const BUILT_IN_STYLES = Object.freeze([
  {
    id: "default",
    name: "Default",
    description: "Natural cleanup while preserving tone."
  },
  {
    id: "professional",
    name: "Professional",
    description: "Concise, polished, and businesslike."
  },
  {
    id: "email",
    name: "Email",
    description: "Clear structure suitable for email."
  },
  {
    id: "casual",
    name: "Casual",
    description: "Conversational with minimal rewriting."
  },
  {
    id: "raw",
    name: "Raw",
    description: "Bypass rewriting where practical."
  }
]);

export const DEFAULT_SETTINGS = Object.freeze({
  sttProvider: "deepgram",
  sttApiKey: "",
  llmProvider: "openai",
  llmApiKey: "",
  defaultStyleId: "default",
  customStyles: []
});

const BUILT_IN_STYLE_IDS = new Set(BUILT_IN_STYLES.map((style) => style.id));

/**
 * Merges stored values with defaults and repairs optional array fields.
 */
export function normalizeSettings(value = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    customStyles: Array.isArray(value.customStyles) ? value.customStyles : []
  };
}

/**
 * Validates user-editable settings before they are persisted.
 *
 * The returned `settings` value is normalized even when validation fails so UI
 * code can render consistent data while showing the first useful error.
 */
export function validateSettings(value) {
  const settings = normalizeSettings(value);
  const errors = {};
  const styleIds = new Set([
    ...BUILT_IN_STYLE_IDS,
    ...settings.customStyles.map((style) => style.id).filter(Boolean)
  ]);

  if (!styleIds.has(settings.defaultStyleId)) {
    errors.defaultStyleId = "Choose a valid default style.";
  }

  if (settings.sttApiKey && typeof settings.sttApiKey !== "string") {
    errors.sttApiKey = "STT API key must be text.";
  }

  if (settings.llmApiKey && typeof settings.llmApiKey !== "string") {
    errors.llmApiKey = "LLM API key must be text.";
  }

  for (const [index, style] of settings.customStyles.entries()) {
    if (!style.id || !style.name || !style.instructions) {
      errors[`customStyles.${index}`] = "Custom styles need an id, name, and instructions.";
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    settings
  };
}

/**
 * Loads settings from Chrome storage, or from an injected storage adapter in
 * tests.
 */
export async function loadSettings(storageArea = getDefaultStorageArea()) {
  const stored = await storageArea.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

/**
 * Validates and persists settings to Chrome storage.
 */
export async function saveSettings(nextSettings, storageArea = getDefaultStorageArea()) {
  const validation = validateSettings(nextSettings);
  if (!validation.ok) {
    return validation;
  }

  await storageArea.set(validation.settings);
  return validation;
}

function getDefaultStorageArea() {
  const storageArea = globalThis.chrome?.storage?.sync;
  if (!storageArea) {
    throw new Error("chrome.storage.sync is unavailable.");
  }
  return storageArea;
}
