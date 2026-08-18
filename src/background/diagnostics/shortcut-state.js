/**
 * Reads Chrome's active command assignment for popup-facing setup state.
 *
 * Manifest `suggested_key` is only a suggestion. The popup needs the runtime
 * command state because Chrome can install the command with an empty shortcut.
 */
const TOGGLE_DICTATION_COMMAND = "toggle-dictation";
const TOGGLE_DICTATION_SUGGESTED_SHORTCUT = "Ctrl+Shift+Space / Command+Shift+Space";
const SHORTCUT_SETTINGS_URL = "chrome://extensions/shortcuts";

export async function getToggleDictationShortcutState(chromeApi) {
  const baseState = {
    suggested: TOGGLE_DICTATION_SUGGESTED_SHORTCUT,
    settingsUrl: SHORTCUT_SETTINGS_URL
  };

  if (typeof chromeApi.commands?.getAll !== "function") {
    return {
      ...baseState,
      assigned: true,
      shortcut: TOGGLE_DICTATION_SUGGESTED_SHORTCUT,
      status: "unknown"
    };
  }

  try {
    const commands = await chromeApi.commands.getAll();
    const command = commands.find((item) => item.name === TOGGLE_DICTATION_COMMAND);

    if (!command) {
      return {
        ...baseState,
        assigned: false,
        shortcut: "",
        status: "missing-command"
      };
    }

    return {
      ...baseState,
      assigned: Boolean(command.shortcut),
      shortcut: command.shortcut || "",
      status: command.shortcut ? "assigned" : "unassigned"
    };
  } catch {
    return {
      ...baseState,
      assigned: true,
      shortcut: TOGGLE_DICTATION_SUGGESTED_SHORTCUT,
      status: "unknown"
    };
  }
}
