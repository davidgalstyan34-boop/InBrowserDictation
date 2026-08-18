const SYNC_KEYS = new Set(["sttProvider", "llmProvider", "defaultStyleId"]);
const LOCAL_KEYS = new Set(["customStyles"]);
const SESSION_KEYS = new Set(["sttApiKey", "llmApiKey"]);

/**
 * Creates Chrome-like sync/local/session areas for settings and controller tests.
 */
export function createMemorySettingsStorage(initialSettings = {}) {
  const values = {
    sync: {},
    local: {},
    session: {}
  };
  const accessLevels = {
    sync: null,
    local: null,
    session: null
  };

  for (const [key, value] of Object.entries(initialSettings)) {
    const area = getAreaForSetting(key);
    values[area][key] = structuredClone(value);
  }

  return {
    sync: createStorageArea("sync", values, accessLevels),
    local: createStorageArea("local", values, accessLevels),
    session: createStorageArea("session", values, accessLevels),
    values,
    accessLevels
  };
}

function getAreaForSetting(key) {
  if (SYNC_KEYS.has(key)) {
    return "sync";
  }

  if (LOCAL_KEYS.has(key)) {
    return "local";
  }

  if (SESSION_KEYS.has(key)) {
    return "session";
  }

  return "session";
}

function createStorageArea(name, values, accessLevels) {
  return {
    get: async (keys) => selectValues(values[name], keys),
    set: async (nextValues) => {
      Object.assign(values[name], structuredClone(nextValues));
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[name][key];
      }
    },
    setAccessLevel: async ({ accessLevel }) => {
      accessLevels[name] = accessLevel;
    }
  };
}

function selectValues(values, keys) {
  if (keys === null || keys === undefined) {
    return structuredClone(values);
  }

  if (typeof keys === "string") {
    return Object.hasOwn(values, keys) ? { [keys]: structuredClone(values[keys]) } : {};
  }

  if (Array.isArray(keys)) {
    return Object.fromEntries(
      keys
        .filter((key) => Object.hasOwn(values, key))
        .map((key) => [key, structuredClone(values[key])])
    );
  }

  return {
    ...structuredClone(keys),
    ...Object.fromEntries(
      Object.keys(keys)
        .filter((key) => Object.hasOwn(values, key))
        .map((key) => [key, structuredClone(values[key])])
    )
  };
}
