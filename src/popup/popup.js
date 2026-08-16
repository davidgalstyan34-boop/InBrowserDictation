import { MessageType, createEnvelope } from "../shared/messages.js";

const elements = {
  statusLine: document.querySelector("#status-line"),
  statusPill: document.querySelector("#status-pill"),
  sessionStatus: document.querySelector("#session-status"),
  styleName: document.querySelector("#style-name"),
  shortcutLabel: document.querySelector("#shortcut-label"),
  shortcutWarning: document.querySelector("#shortcut-warning"),
  shortcutSettingsButton: document.querySelector("#shortcut-settings-button"),
  toggleButton: document.querySelector("#toggle-button"),
  optionsButton: document.querySelector("#options-button"),
  recentResult: document.querySelector("#recent-result"),
  resultMeta: document.querySelector("#result-meta"),
  copyFinalButton: document.querySelector("#copy-final-button"),
  copyRawButton: document.querySelector("#copy-raw-button"),
  retryButton: document.querySelector("#retry-button"),
  popupStatus: document.querySelector("#popup-status")
};

let popupState = null;
const SHORTCUT_SETTINGS_URL = "chrome://extensions/shortcuts";

void initializePopup();

async function initializePopup() {
  registerEvents();
  await refreshPopupState();
}

function registerEvents() {
  elements.toggleButton.addEventListener("click", async () => {
    await runPopupAction(async () => {
      elements.toggleButton.disabled = true;
      await sendRuntimeMessage(MessageType.RUNTIME_TOGGLE_DICTATION);
      await refreshPopupState();
    }, "Dictation command sent.");
  });

  elements.optionsButton.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  elements.shortcutSettingsButton.addEventListener("click", async () => {
    await runPopupAction(async () => {
      await chrome.tabs.create({ url: getShortcutSettingsUrl(popupState?.shortcut) });
    }, "Opening Chrome shortcuts.");
  });

  elements.copyFinalButton.addEventListener("click", async () => {
    await copyText(popupState?.recentResult?.finalText, "Copied final result.");
  });

  elements.copyRawButton.addEventListener("click", async () => {
    await copyText(popupState?.recentResult?.rawTranscript, "Copied raw transcript.");
  });

  elements.retryButton.addEventListener("click", async () => {
    await runPopupAction(async () => {
      elements.retryButton.disabled = true;
      const response = await sendRuntimeMessage(MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT);
      popupState = {
        ...popupState,
        recentResult: response.recentResult
      };
      renderPopupState(popupState);
    }, "Rewrite retried.");
  });
}

async function refreshPopupState() {
  try {
    popupState = await sendRuntimeMessage(MessageType.RUNTIME_GET_POPUP_STATE);
    renderPopupState(popupState);
    showStatus("");
  } catch (error) {
    renderErrorState(error);
  }
}

function renderPopupState(state) {
  const status = state?.session?.status ?? "IDLE";
  const recentResult = state?.recentResult ?? null;
  const shortcutState = normalizeShortcutState(state?.shortcut);
  const canCopyFinal = Boolean(recentResult?.finalText);
  const canCopyRaw = Boolean(recentResult?.rawTranscript);
  const canRetry = canCopyRaw && canRetryDuringStatus(status);

  elements.statusLine.textContent = getStatusLine(status, state?.configuration, shortcutState);
  elements.statusPill.textContent = getStatusPillLabel(status);
  elements.statusPill.dataset.tone = getStatusTone(status, state?.configuration, shortcutState);
  elements.sessionStatus.textContent = formatStatus(status);
  elements.styleName.textContent = state?.style?.name ?? "Default";
  elements.shortcutLabel.textContent = shortcutState.assigned ? shortcutState.label : "Not set";
  elements.shortcutLabel.dataset.tone = shortcutState.assigned ? "default" : "warning";
  elements.shortcutWarning.textContent = getShortcutWarning(shortcutState);
  elements.shortcutWarning.hidden = shortcutState.assigned;
  elements.shortcutSettingsButton.hidden = shortcutState.assigned;
  elements.shortcutSettingsButton.disabled = shortcutState.assigned;

  elements.toggleButton.textContent = getToggleButtonLabel(status);
  elements.toggleButton.disabled = !canToggleStatus(status);

  elements.recentResult.value = recentResult?.finalText ?? "";
  elements.resultMeta.textContent = recentResult
    ? `${recentResult.finalTextLength} chars`
    : "None";
  elements.copyFinalButton.disabled = !canCopyFinal;
  elements.copyRawButton.disabled = !canCopyRaw;
  elements.retryButton.disabled = !canRetry;
}

function renderErrorState(error) {
  elements.statusLine.textContent = "State unavailable";
  elements.statusPill.textContent = "Error";
  elements.statusPill.dataset.tone = "error";
  elements.sessionStatus.textContent = "Unavailable";
  elements.styleName.textContent = "Unavailable";
  elements.shortcutLabel.textContent = "Unavailable";
  elements.shortcutWarning.hidden = true;
  elements.shortcutSettingsButton.hidden = true;
  elements.toggleButton.disabled = true;
  elements.copyFinalButton.disabled = true;
  elements.copyRawButton.disabled = true;
  elements.retryButton.disabled = true;
  showStatus(error.message || "Popup state could not be loaded.", "error");
}

async function runPopupAction(action, successMessage) {
  try {
    showStatus("");
    await action();
    showStatus(successMessage, "success");
  } catch (error) {
    showStatus(error.message || "Action failed.", "error");
  } finally {
    renderPopupState(popupState);
  }
}

async function copyText(text, successMessage) {
  if (!text) {
    showStatus("No text is available to copy.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showStatus(successMessage, "success");
  } catch {
    showStatus("Clipboard write failed from the popup.", "error");
  }
}

async function sendRuntimeMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage(createEnvelope(type, payload));
  if (response?.ok) {
    return response;
  }

  const error = new Error(response?.error?.message || "Runtime request failed.");
  error.code = response?.error?.code || "RUNTIME_REQUEST_FAILED";
  throw error;
}

function showStatus(message, tone = "default") {
  elements.popupStatus.textContent = message;
  elements.popupStatus.dataset.tone = tone;
}

function getStatusLine(status, configuration, shortcutState) {
  if (!shortcutState.assigned) {
    return "Shortcut not set";
  }

  if (!configuration?.sttApiKey.configured) {
    return "Deepgram key missing";
  }

  if (configuration.llmApiKey.required && !configuration.llmApiKey.configured) {
    return "Gemini key missing";
  }

  if (status === "RECORDING") {
    return "Microphone is active";
  }

  if (isBusyStatus(status)) {
    return "Processing dictation";
  }

  if (status === "ERROR") {
    return "Last session failed";
  }

  return "Ready";
}

function getStatusPillLabel(status) {
  const labels = {
    IDLE: "Ready",
    RECORDING: "Live",
    SUCCESS: "Done",
    ERROR: "Error"
  };

  return labels[status] ?? "Busy";
}

function getStatusTone(status, configuration, shortcutState) {
  if (!shortcutState.assigned) {
    return "warning";
  }

  if (!configuration?.sttApiKey.configured || (
    configuration.llmApiKey.required && !configuration.llmApiKey.configured
  )) {
    return "warning";
  }

  if (status === "SUCCESS") {
    return "success";
  }

  if (status === "ERROR") {
    return "error";
  }

  return isBusyStatus(status) ? "busy" : "ready";
}

function getToggleButtonLabel(status) {
  if (status === "RECORDING") {
    return "Stop Dictation";
  }

  if (canToggleStatus(status)) {
    return "Start Dictation";
  }

  return "Working";
}

function canToggleStatus(status) {
  return status === "IDLE"
    || status === "RECORDING"
    || status === "SUCCESS"
    || status === "ERROR";
}

function canRetryDuringStatus(status) {
  return status === "IDLE"
    || status === "SUCCESS"
    || status === "ERROR";
}

function isBusyStatus(status) {
  return !canToggleStatus(status);
}

function normalizeShortcutState(shortcut) {
  if (typeof shortcut === "string") {
    return {
      assigned: Boolean(shortcut),
      label: shortcut || "Not set",
      suggested: "Ctrl+Shift+Space / Command+Shift+Space",
      status: shortcut ? "assigned" : "unassigned",
      settingsUrl: SHORTCUT_SETTINGS_URL
    };
  }

  const activeShortcut = typeof shortcut?.shortcut === "string" ? shortcut.shortcut : "";
  const suggested = typeof shortcut?.suggested === "string"
    ? shortcut.suggested
    : "Ctrl+Shift+Space / Command+Shift+Space";
  const assigned = shortcut?.assigned === false ? false : Boolean(activeShortcut);

  return {
    assigned,
    label: activeShortcut || "Not set",
    suggested,
    status: shortcut?.status ?? (assigned ? "assigned" : "unassigned"),
    settingsUrl: getShortcutSettingsUrl(shortcut)
  };
}

function getShortcutWarning(shortcutState) {
  if (shortcutState.status === "missing-command") {
    return "Keyboard command is missing. Reload the extension, then check Chrome shortcuts.";
  }

  return `Keyboard shortcut is not assigned in Chrome. Suggested: ${shortcutState.suggested}.`;
}

function getShortcutSettingsUrl(shortcut) {
  return typeof shortcut?.settingsUrl === "string"
    ? shortcut.settingsUrl
    : SHORTCUT_SETTINGS_URL;
}

function formatStatus(status) {
  return String(status || "IDLE")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}
