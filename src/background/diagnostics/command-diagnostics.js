/**
 * Logs command shortcut registration state for manual extension debugging.
 *
 * Chrome treats manifest `suggested_key` values as suggestions. A command can
 * exist but have an empty shortcut if Chrome rejects the key, another extension
 * already owns it, or the user/profile has left it unassigned.
 */
export function createCommandDiagnostics({ chromeApi }) {
  return {
    logShortcutState
  };

  /**
   * Prints registered commands and calls out unassigned shortcuts.
   */
  async function logShortcutState(reason) {
    try {
      const commands = await chromeApi.commands.getAll();
      const missingShortcuts = commands
        .filter((command) => !command.shortcut)
        .map((command) => command.name);

      console.info("[In-Browser Dictation] Registered commands.", {
        reason,
        commands
      });

      if (missingShortcuts.length > 0) {
        console.warn(
          "[In-Browser Dictation] Some commands have no shortcut. Set them at chrome://extensions/shortcuts.",
          { missingShortcuts }
        );
      }
    } catch (error) {
      console.warn("[In-Browser Dictation] Could not inspect command shortcuts.", error);
    }
  }
}
