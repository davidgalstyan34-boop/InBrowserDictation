import { describeAudioMetadata } from "../../shared/audio-recording.js";
import {
  describeInsertionState,
  describeOutputTextState,
  describeRecordingState,
  describeTranscriptionState
} from "./overlay-descriptions.js";

/**
 * Owns page-overlay copy for background lifecycle flows.
 *
 * Flow modules decide when state changes happen; this module converts those
 * session states into metadata-only content-script messages.
 */

/**
 * Shows the first visible response to a shortcut-triggered session.
 */
export async function showStartingState(content, session) {
  await content.showState(session.tabId, session.id, {
    status: session.status,
    title: "Starting",
    detail: "Shortcut received"
  });
}

/**
 * Shows busy feedback for repeated shortcut presses during non-toggleable work.
 */
export async function showBusyState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Busy",
    detail: "Dictation is already working"
  });
}

/**
 * Shows the active recording state after the offscreen document starts.
 */
export async function showRecordingState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Listening",
    detail: describeRecordingState(session)
  });
}

/**
 * Shows recorder shutdown progress.
 */
export async function showStoppingState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Stopping",
    detail: "Finalizing audio"
  });
}

/**
 * Shows STT provider progress without exposing transcript text.
 */
export async function showTranscribingState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Transcribing",
    detail: describeAudioMetadata(session.audio)
  });
}

/**
 * Shows text improvement progress without exposing transcript text.
 */
export async function showImprovingState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Improving",
    detail: describeTranscriptionState(session.transcription)
  });
}

/**
 * Shows that final private text is ready for insertion.
 */
export async function showInsertionReadyState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: session.warning ? "Inserting raw transcript" : "Inserting",
    detail: describeOutputTextState(session.outputText, session.warning),
    tone: session.warning ? "warning" : "default"
  });
}

/**
 * Shows final target insertion or clipboard fallback metadata.
 */
export async function showInsertionCompleteState(content, session) {
  const usedClipboard = session.insertion?.method === "clipboard";

  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: usedClipboard ? "Copied to clipboard" : "Inserted",
    detail: describeInsertionState(session.insertion, session.warning),
    tone: usedClipboard || session.warning ? "warning" : "success"
  });
}

/**
 * Shows that startup is paused while Chrome requires visible permission UI.
 */
export async function showMicrophonePermissionNeededState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Microphone access needed",
    detail: "A permission window was opened",
    tone: "muted"
  });
}

/**
 * Shows that visible microphone permission succeeded and recording is retrying.
 */
export async function showMicrophoneAccessGrantedState(content, session) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Microphone access granted",
    detail: "Starting recording"
  });
}

/**
 * Shows normalized terminal failure feedback.
 */
export async function showFailureState(content, session, message) {
  await content.safeShowState(session.tabId, session.id, {
    status: session.status,
    title: "Dictation failed",
    detail: message,
    tone: "error"
  });
}
