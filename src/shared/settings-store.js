import { normalizeSettings, validateSettings } from "./settings.js";

const SYNC_SETTING_KEYS = Object.freeze([
  "sttProvider",
  "llmProvider",
  "defaultStyleId"
]);
const SESSION_SECRET_KEYS = Object.freeze([
  "sttApiKey",
  "llmApiKey"
]);
const CUSTOM_STYLES_KEY = "customStyles";

/**
 * Loads settings from storage areas chosen for their data sensitivity and size.
 *
 * Ordinary preferences remain synchronized, custom styles use local storage to
 * avoid Sync's per-item quota, and provider credentials remain memory-only for
 * the current Chrome session.
 */
export async function loadSettings(storage = getDefaultSettingsStorage()) {
  const areas = requireSettingsStorage(storage);
  const [synced, local, secrets] = await Promise.all([
    areas.sync.get(SYNC_SETTING_KEYS),
    areas.local.get([CUSTOM_STYLES_KEY]),
    areas.session.get(SESSION_SECRET_KEYS)
  ]);

  return normalizeSettings({
    ...pickSettings(synced, SYNC_SETTING_KEYS),
    ...pickSettings(secrets, SESSION_SECRET_KEYS),
    customStyles: local[CUSTOM_STYLES_KEY]
  });
}

/**
 * Validates and persists each settings category in its intended storage area.
 */
export async function saveSettings(nextSettings, storage = getDefaultSettingsStorage()) {
  const validation = validateSettings(nextSettings);
  if (!validation.ok) {
    return validation;
  }

  const areas = requireSettingsStorage(storage);
  const settings = validation.settings;

  await Promise.all([
    areas.sync.set(pickSettings(settings, SYNC_SETTING_KEYS)),
    areas.local.set({ [CUSTOM_STYLES_KEY]: settings.customStyles }),
    areas.session.set(pickSettings(settings, SESSION_SECRET_KEYS))
  ]);

  return validation;
}

/**
 * Keeps settings storage inaccessible to content scripts, which do not own any
 * settings behavior. Older Chrome versions without this API retain defaults.
 */
export async function restrictSettingsStorageAccess(storage = getDefaultSettingsStorage()) {
  const areas = requireSettingsStorage(storage);
  const access = { accessLevel: "TRUSTED_CONTEXTS" };

  await Promise.all(
    [areas.sync, areas.local, areas.session]
      .filter((area) => typeof area.setAccessLevel === "function")
      .map((area) => area.setAccessLevel(access))
  );
}

function pickSettings(settings, keys) {
  return Object.fromEntries(keys.map((key) => [key, settings[key]]));
}

function requireSettingsStorage(storage) {
  for (const area of ["sync", "local", "session"]) {
    if (typeof storage?.[area]?.get !== "function" || typeof storage[area].set !== "function") {
      throw new Error(`chrome.storage.${area} is unavailable.`);
    }
  }

  return storage;
}

function getDefaultSettingsStorage() {
  const storage = globalThis.chrome?.storage;
  if (!storage) {
    throw new Error("chrome.storage is unavailable.");
  }

  return storage;
}
