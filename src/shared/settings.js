/**
 * Built-in rewrite styles available before custom style management exists.
 *
 * Provider modules use these records as code-owned rewrite instructions while
 * the options page uses them to present stable style IDs and descriptions.
 */
export const BUILT_IN_STYLES = Object.freeze([
  {
    id: "default",
    name: "Default",
    description: "Natural cleanup while preserving tone.",
    instructions: "Clean up speech-to-text artifacts, punctuation, and casing while preserving the speaker's original tone."
  },
  {
    id: "professional",
    name: "Professional",
    description: "Concise, polished, and businesslike.",
    instructions: "Make the text concise, polished, and businesslike without making it stiff or adding new claims."
  },
  {
    id: "email",
    name: "Email",
    description: "Clear structure suitable for email.",
    instructions: "Format the text as a clear email-ready message, using paragraphs where useful but no subject line unless one is already present."
  },
  {
    id: "casual",
    name: "Casual",
    description: "Conversational with minimal rewriting.",
    instructions: "Keep the text conversational and lightly edited, changing only what improves readability."
  },
  {
    id: "raw",
    name: "Raw",
    description: "Bypass rewriting where practical.",
    instructions: "Return the transcript unchanged."
  }
]);

export const SUPPORTED_STT_PROVIDERS = Object.freeze(["deepgram"]);
export const SUPPORTED_LLM_PROVIDERS = Object.freeze(["gemini"]);

export const DEFAULT_SETTINGS = Object.freeze({
  sttProvider: "deepgram",
  sttApiKey: "",
  llmProvider: "gemini",
  llmApiKey: "",
  defaultStyleId: "default",
  customStyles: []
});

const BUILT_IN_STYLE_IDS = new Set(BUILT_IN_STYLES.map((style) => style.id));

/**
 * Merges stored values with defaults and repairs optional array fields.
 */
export function normalizeSettings(value = {}) {
  const sttProvider = normalizeProvider(
    value.sttProvider,
    SUPPORTED_STT_PROVIDERS,
    DEFAULT_SETTINGS.sttProvider
  );
  const llmProvider = normalizeProvider(
    value.llmProvider,
    SUPPORTED_LLM_PROVIDERS,
    DEFAULT_SETTINGS.llmProvider
  );
  const obsoleteSttProvider = typeof value.sttProvider === "string" && value.sttProvider !== sttProvider;
  const obsoleteLlmProvider = typeof value.llmProvider === "string" && value.llmProvider !== llmProvider;

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    sttProvider,
    sttApiKey: obsoleteSttProvider ? "" : value.sttApiKey ?? "",
    llmProvider,
    llmApiKey: obsoleteLlmProvider ? "" : value.llmApiKey ?? "",
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
 * Resolves the selected rewrite style from normalized settings.
 *
 * Built-in styles are preferred over custom styles with the same id so P0/P1
 * behavior remains stable even if later custom-style management allows edits.
 */
export function resolveRewriteStyle(settingsValue = {}) {
  const settings = normalizeSettings(settingsValue);
  const customStyles = settings.customStyles.filter(isCompleteCustomStyle);

  return BUILT_IN_STYLES.find((style) => style.id === settings.defaultStyleId)
    ?? customStyles.find((style) => style.id === settings.defaultStyleId)
    ?? BUILT_IN_STYLES[0];
}

/**
 * Reports which credentials are required for the selected processing path.
 *
 * The Raw style bypasses the LLM provider, so the Gemini key is optional while
 * the Deepgram key remains required for every dictation session.
 */
export function getConfigurationRequirements(settingsValue = {}) {
  const settings = normalizeSettings(settingsValue);
  const style = resolveRewriteStyle(settings);
  const llmRequired = style.id !== "raw";

  return {
    styleId: style.id,
    styleName: style.name,
    sttApiKey: {
      required: true,
      configured: hasConfiguredApiKey(settings.sttApiKey)
    },
    llmApiKey: {
      required: llmRequired,
      configured: hasConfiguredApiKey(settings.llmApiKey),
      bypassed: !llmRequired
    }
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

function isCompleteCustomStyle(style) {
  return Boolean(style?.id && style.name && style.instructions);
}

function normalizeProvider(value, supportedProviders, fallback) {
  return supportedProviders.includes(value) ? value : fallback;
}

function hasConfiguredApiKey(value) {
  return typeof value === "string" && value.trim().length > 0;
}
