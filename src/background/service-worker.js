import { DictationEvent, DictationStatus, canAcceptStart, canAcceptStop, transitionStatus } from "../shared/dictation-state.js";
import { MessageType, createEnvelope, isMessage } from "../shared/messages.js";

let currentSession = createIdleSession();

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-dictation") {
    void handleToggleCommand();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isMessage(message)) {
    return false;
  }

  if (message.type === MessageType.RUNTIME_GET_STATE) {
    sendResponse({
      ok: true,
      session: toPublicSession(currentSession)
    });
    return false;
  }

  return false;
});

async function handleToggleCommand() {
  if (canAcceptStart(currentSession.status)) {
    await startPhaseOneSession();
    return;
  }

  if (canAcceptStop(currentSession.status)) {
    await cancelPhaseOneSession();
    return;
  }

  if (currentSession.status === DictationStatus.ERROR || currentSession.status === DictationStatus.SUCCESS) {
    currentSession = createIdleSession();
  }
}

async function startPhaseOneSession() {
  const tab = await getActiveTab();
  const sessionId = crypto.randomUUID();

  currentSession = {
    id: sessionId,
    status: transitionStatus(DictationStatus.IDLE, DictationEvent.START_REQUESTED),
    tabId: tab?.id ?? null,
    startedAt: Date.now(),
    target: null,
    error: null
  };

  if (!tab?.id) {
    failSession("NO_ACTIVE_TAB", "No active tab is available for dictation.");
    return;
  }

  try {
    await sendTabMessage(tab.id, createEnvelope(
      MessageType.CONTENT_SHOW_STATE,
      {
        status: DictationStatus.STARTING,
        title: "Starting",
        detail: "Shortcut received"
      },
      sessionId
    ));

    const response = await sendTabMessage(tab.id, createEnvelope(
      MessageType.CONTENT_PREPARE_DICTATION,
      { source: "keyboard-command" },
      sessionId
    ));

    if (!response?.ok) {
      throw new Error(response?.error?.message || "The page could not prepare for dictation.");
    }

    currentSession = {
      ...currentSession,
      status: transitionStatus(currentSession.status, DictationEvent.TARGET_READY),
      target: response.target ?? null
    };

    await sendTabMessage(tab.id, createEnvelope(
      MessageType.CONTENT_SHOW_STATE,
      {
        status: currentSession.status,
        title: "Ready",
        detail: describePreparedTarget(currentSession.target)
      },
      sessionId
    ));
  } catch (error) {
    failSession("CONTENT_UNAVAILABLE", error.message);
  }
}

async function cancelPhaseOneSession() {
  const session = currentSession;
  currentSession = {
    ...session,
    status: transitionStatus(session.status, DictationEvent.STOP_REQUESTED)
  };

  if (session.tabId) {
    try {
      await sendTabMessage(session.tabId, createEnvelope(
        MessageType.CONTENT_CANCEL_DICTATION,
        {
          title: "Cancelled",
          detail: "Dictation stopped"
        },
        session.id
      ));
    } catch {
      // The tab may have navigated or closed. Phase 5 will convert this into safe fallback behavior.
    }
  }

  currentSession = createIdleSession();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function sendTabMessage(tabId, message) {
  return await chrome.tabs.sendMessage(tabId, message);
}

function failSession(code, message) {
  currentSession = {
    ...currentSession,
    status: DictationStatus.ERROR,
    error: { code, message }
  };
}

function createIdleSession() {
  return {
    id: null,
    status: DictationStatus.IDLE,
    tabId: null,
    startedAt: null,
    target: null,
    error: null
  };
}

function toPublicSession(session) {
  return {
    id: session.id,
    status: session.status,
    tabId: session.tabId,
    startedAt: session.startedAt,
    target: session.target,
    error: session.error
  };
}

function describePreparedTarget(target) {
  if (!target || target.kind === "none") {
    return "No editable target captured";
  }

  if (target.kind === "blocked") {
    return target.reason;
  }

  return `${target.kind} target captured`;
}
