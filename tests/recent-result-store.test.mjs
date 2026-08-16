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
      },
      insertion: null,
      warning: null,
      completedAt: 2000
    }, () => 3000);

    assert.equal(result.finalText, "Final transcript.");
    assert.equal(result.rawTranscript, "raw transcript");
    assert.equal(result.insertion, null);
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
      },
      insertion: {
        method: "target",
        targetKind: "textarea",
        textLength: 17
      },
      warning: null,
      completedAt: 2000
    }, () => 3000);

    assert.deepEqual(result, {
      sessionId: "session-1",
      rawTranscript: "raw transcript",
      rawTextLength: 14,
      finalText: "Final transcript.",
      finalTextLength: 17,
      outputSource: "llm",
      styleId: "default",
      warning: null,
      insertion: {
        method: "target",
        strategy: null,
        targetKind: "textarea",
        textLength: 17,
        fallbackReason: null
      },
      completedAt: 2000,
      capturedAt: 3000
    });
  });

  it("persists only the latest result through the provided temporary storage", async () => {
    const storage = createMemoryStorage();
    const store = createRecentResultStore({
      storageArea: storage,
      now: () => 4000
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
