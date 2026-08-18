import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadSettings,
  restrictSettingsStorageAccess,
  saveSettings
} from "../src/shared/settings-store.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";
import { createMemorySettingsStorage } from "./helpers/settings-storage.mjs";

describe("settings storage", () => {
  it("stores secrets in session, styles locally, and preferences in sync", async () => {
    const storage = createMemorySettingsStorage();
    const customStyles = [{
      id: "engineering",
      name: "Engineering",
      description: "",
      instructions: "Write a concise technical update."
    }];

    const result = await saveSettings({
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-secret",
      llmApiKey: "gemini-secret",
      defaultStyleId: "engineering",
      customStyles
    }, storage);

    assert.equal(result.ok, true);
    assert.deepEqual(storage.values.sync, {
      sttProvider: "deepgram",
      llmProvider: "gemini",
      defaultStyleId: "engineering"
    });
    assert.deepEqual(storage.values.local, { customStyles });
    assert.deepEqual(storage.values.session, {
      sttApiKey: "deepgram-secret",
      llmApiKey: "gemini-secret"
    });
  });

  it("keeps a valid large style collection out of Sync's per-item quota", async () => {
    const storage = createMemorySettingsStorage();
    const customStyles = Array.from({ length: 8 }, (_, index) => ({
      id: `style-${index + 1}`,
      name: `Style ${index + 1}`,
      description: "",
      instructions: "x".repeat(2000)
    }));

    assert.ok(JSON.stringify(customStyles).length > 8192);
    const result = await saveSettings({
      ...DEFAULT_SETTINGS,
      customStyles
    }, storage);

    assert.equal(result.ok, true);
    assert.equal(Object.hasOwn(storage.values.sync, "customStyles"), false);
    assert.equal(storage.values.local.customStyles.length, 8);
  });

  it("loads one normalized settings object from all three areas", async () => {
    const storage = createMemorySettingsStorage({
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-secret",
      llmApiKey: "gemini-secret",
      defaultStyleId: "raw",
      customStyles: []
    });

    assert.deepEqual(await loadSettings(storage), {
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-secret",
      llmApiKey: "gemini-secret",
      defaultStyleId: "raw"
    });
  });

  it("keeps preferences and styles after session credentials are cleared", async () => {
    const storage = createMemorySettingsStorage({
      ...DEFAULT_SETTINGS,
      sttApiKey: "temporary-deepgram",
      llmApiKey: "temporary-gemini",
      defaultStyleId: "professional"
    });

    storage.values.session = {};
    const loaded = await loadSettings(storage);

    assert.equal(loaded.sttApiKey, "");
    assert.equal(loaded.llmApiKey, "");
    assert.equal(loaded.defaultStyleId, "professional");
  });

  it("restricts every settings area to trusted extension contexts", async () => {
    const storage = createMemorySettingsStorage();

    await restrictSettingsStorageAccess(storage);

    assert.deepEqual(storage.accessLevels, {
      sync: "TRUSTED_CONTEXTS",
      local: "TRUSTED_CONTEXTS",
      session: "TRUSTED_CONTEXTS"
    });
  });
});
