import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationStatus } from "../src/shared/dictation-state.js";
import {
  createRecentResultFromSession,
  createRecentResultStore
} from "../src/background/session/recent-result-store.js";

describe("recent result store", () => {
  it("creates a recoverable result before insertion has been attempted", () => {
    const result = createRecentResultFromSession({
      id: "session-inserting",
      status: DictationStatus.INSERTING,
      transcription: { transcript: "raw transcript" },
      outputText: {
        text: "Final transcript.",
        source: "llm",
        styleId: "default"
      }
    });

    assert.equal(result.finalText, "Final transcript.");
    assert.equal(result.rawTranscript, "raw transcript");
  });

  it("ignores sessions that have not produced final text yet", () => {
    assert.equal(createRecentResultFromSession({
      id: "session-transcribing",
      status: DictationStatus.TRANSCRIBING,
      transcription: { transcript: "raw transcript" },
      outputText: null
    }), null);

    assert.equal(createRecentResultFromSession({
      id: "session-empty",
      status: DictationStatus.INSERTING,
      outputText: { text: "" }
    }), null);
  });

  it("creates a recoverable result from a successful private session", () => {
    const result = createRecentResultFromSession({
      id: "session-1",
      status: DictationStatus.SUCCESS,
      transcription: {
        transcript: "raw transcript"
      },
      outputText: {
        text: "Final transcript.",
        source: "llm",
        styleId: "default"
      }
    });

    assert.deepEqual(result, {
      rawTranscript: "raw transcript",
      finalText: "Final transcript.",
      finalTextLength: 17
    });
  });

  it("persists only the latest result through the provided temporary storage", async () => {
    const storage = createMemoryStorage();
    const store = createRecentResultStore({
      storageArea: storage
    });

    await store.save({
      finalText: "First",
      rawTranscript: "first raw"
    });
    const latest = await store.save({
      finalText: "Second",
      rawTranscript: "second raw"
    });

    assert.equal(latest.finalText, "Second");
    assert.equal((await store.load()).rawTranscript, "second raw");
    assert.equal(storage.value.recentResult.finalText, "Second");
  });
});

function createMemoryStorage() {
  const value = {};

  return {
    value,
    async get(defaults) {
      return {
        ...defaults,
        ...value
      };
    },
    async set(nextValues) {
      Object.assign(value, nextValues);
    },
    async remove(key) {
      delete value[key];
    }
  };
}
