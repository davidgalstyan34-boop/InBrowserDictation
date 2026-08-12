import { DictationEvent, DictationStatus, transitionStatus } from "../shared/dictation-state.js";
import { MessageType, createEnvelope, parseMessageEnvelope } from "../shared/messages.js";

// Keep the authoritative session in the service worker so popup/options UI can
// come and go without owning dictation lifecycle state.
let currentSession = createIdleSession();

const commandHandlers = Object.freeze({
  "toggle-dictation": handleToggleCommand
});

const runtimeMessageHandlers = Object.freeze({
  [MessageType.RUNTIME_GET_STATE]: reportRuntimeState
});

const toggleActionsByStatus = Object.freeze({
  [DictationStatus.IDLE]: startDictationSession,
  [DictationStatus.RECORDING]: stopDictationSession,
  [DictationStatus.SUCCESS]: resetSession,
  [DictationStatus.ERROR]: resetSession
});

chrome.commands.onCommand.addListener((command) => {
  const handler = commandHandlers[command];
  if (handler) {
    handler();
  }
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = parseMessageEnvelope(rawMessage);
  const handler = message ? runtimeMessageHandlers[message.type] : null;

  if (!handler) {
    return false;
  }

  return handler({ message, sender, sendResponse });
});

async function handleToggleCommand() {
  const action = toggleActionsByStatus[currentSession.status] ?? reportBusySession;
  await action();
}

async function startDictationSession() {
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
    // Acknowledge the shortcut before doing any heavier work. Recording and
    // provider setup can continue without making the command feel ignored.
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

function reportRuntimeState({ sendResponse }) {
  sendResponse({
    ok: true,
    session: toPublicSession(currentSession)
  });
  return false;
}

async function reportBusySession() {
  if (!currentSession.tabId) {
    return;
  }

  await sendTabMessage(currentSession.tabId, createEnvelope(
    MessageType.CONTENT_SHOW_STATE,
    {
      status: currentSession.status,
      title: "Busy",
      detail: "Dictation is already working"
    },
    currentSession.id
  ));
}

async function stopDictationSession() {
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
      // The tab may have navigated or closed. Dictation should fail safely
      // instead of targeting whichever page happens to be focused next.
    }
  }

  resetSession();
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

function resetSession() {
  currentSession = createIdleSession();
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
  const kind = target?.kind ?? "none";
  const descriptionActions = {
    none: () => "No editable target captured",
    blocked: () => target.reason
  };

  const action = descriptionActions[kind];
  return action ? action() : `${kind} target captured`;
}
