import { createDictationController } from "./controller/dictation-controller.js";
import { createCommandDiagnostics } from "./diagnostics/command-diagnostics.js";

// Manifest V3 service worker entrypoint.
//
// Keep this file intentionally thin: Chrome event registration belongs here,
// while dictation lifecycle, session state, tab messaging, and offscreen
// recorder details live in delegated background modules.
const dictationController = createDictationController({
  chromeApi: chrome,
  clientsApi: globalThis.clients,
  cryptoApi: crypto
});
const commandDiagnostics = createCommandDiagnostics({ chromeApi: chrome });

void commandDiagnostics.logShortcutState("service-worker-load");

chrome.commands.onCommand.addListener((command, tab) => {
  console.info("[In-Browser Dictation] Command received.", {
    command,
    tabId: tab?.id
  });

  void dictationController.handleCommand(command, { tab }).catch((error) => {
    console.error("[In-Browser Dictation] Command failed.", error);
  });
});

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => (
  dictationController.handleRuntimeMessage({ rawMessage, sendResponse })
));

chrome.tabs.onRemoved.addListener((tabId) => {
  void dictationController.handleTabRemoved(tabId).catch((error) => {
    console.error("[In-Browser Dictation] Tab removal handling failed.", error);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  void commandDiagnostics.logShortcutState(`installed:${details.reason}`);
});

chrome.runtime.onStartup.addListener(() => {
  void commandDiagnostics.logShortcutState("startup");
});
