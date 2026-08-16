import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGeminiCompatibilityStore } from "../src/background/providers/gemini-compatibility.js";

describe("Gemini compatibility store", () => {
  it("remembers a working pair across reads", async () => {
    const { storageArea, written } = createStorage();
    const store = createGeminiCompatibilityStore({ storageArea });

    await store.save({ model: "gemini-a", requestShape: "inline-instructions" });

    assert.deepEqual(await store.load(), {
      model: "gemini-a",
      requestShape: "inline-instructions"
    });
    assert.equal(written.length, 1);
  });

  it("does not rewrite storage for an unchanged pair", async () => {
    const { storageArea, written } = createStorage();
    const store = createGeminiCompatibilityStore({ storageArea });

    await store.save({ model: "gemini-a", requestShape: "inline-instructions" });
    await store.save({ model: "gemini-a", requestShape: "inline-instructions" });

    assert.equal(written.length, 1);
  });

  it("discards a stored pair this build no longer offers", async () => {
    const { storageArea } = createStorage({
      geminiCompatibility: { model: "gemini-retired", requestShape: "inline-instructions" }
    });
    const store = createGeminiCompatibilityStore({
      storageArea,
      isSupported: (model) => model !== "gemini-retired"
    });

    assert.equal(await store.load(), null);
  });

  it("ignores a malformed stored value", async () => {
    const { storageArea } = createStorage({ geminiCompatibility: { model: 42 } });
    const store = createGeminiCompatibilityStore({ storageArea });

    assert.equal(await store.load(), null);
  });

  it("keeps working when storage is unavailable", async () => {
    const store = createGeminiCompatibilityStore({ storageArea: null });

    assert.equal(await store.load(), null);
    await store.save({ model: "gemini-a", requestShape: "inline-instructions" });

    // Held in memory, so the ladder is still skipped for the rest of this worker.
    assert.deepEqual(await store.load(), {
      model: "gemini-a",
      requestShape: "inline-instructions"
    });
  });

  it("survives a storage read or write that throws", async () => {
    const store = createGeminiCompatibilityStore({
      storageArea: {
        get: async () => {
          throw new Error("storage unavailable");
        },
        set: async () => {
          throw new Error("storage unavailable");
        }
      }
    });

    assert.equal(await store.load(), null);
    assert.deepEqual(await store.save({ model: "gemini-a", requestShape: "inline-instructions" }), {
      model: "gemini-a",
      requestShape: "inline-instructions"
    });
  });
});

function createStorage(initial = {}) {
  const written = [];
  let value = { ...initial };

  return {
    written,
    storageArea: {
      get: async (defaults) => ({ ...defaults, ...value }),
      set: async (next) => {
        written.push(next);
        value = { ...value, ...next };
      }
    }
  };
}
