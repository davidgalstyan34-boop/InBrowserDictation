import { getConfigurationRequirements } from "../shared/settings.js";

/**
 * Keeps settings-page credential feedback aligned with the selected style.
 */
export function syncConfigurationFeedback(elements, settings) {
  const requirements = getConfigurationRequirements(settings);

  setKeyState(elements.sttKeyState, requirements.sttApiKey.configured ? "ready" : "missing");
  setKeyState(elements.llmKeyState, getLlmKeyState(requirements));

  elements.llmApiKey.required = requirements.llmApiKey.required;
  elements.sttApiKeyHelp.textContent = "Required before dictation can transcribe audio. Kept only for this Chrome session.";
  elements.llmApiKeyHelp.textContent = requirements.llmApiKey.required
    ? "Required for the selected style and kept only for this Chrome session. Choose Raw to skip Gemini."
    : "Optional while Raw is selected; any saved key remains only for this Chrome session.";
}

/**
 * Returns field-level errors for credentials required by the active path.
 */
export function getRequiredConfigurationErrors(settings) {
  const requirements = getConfigurationRequirements(settings);
  const errors = {};

  if (!requirements.sttApiKey.configured) {
    errors.sttApiKey = "Deepgram API key is required before dictation can transcribe audio.";
  }

  if (requirements.llmApiKey.required && !requirements.llmApiKey.configured) {
    errors.llmApiKey = "Gemini API key is required for the selected style. Choose Raw to skip Gemini.";
  }

  return errors;
}

function getLlmKeyState(requirements) {
  if (requirements.llmApiKey.bypassed) {
    return "optional";
  }

  return requirements.llmApiKey.configured ? "ready" : "missing";
}

function setKeyState(element, state) {
  const labels = {
    ready: "Ready",
    missing: "Missing",
    optional: "Optional"
  };

  element.dataset.state = state;
  element.textContent = labels[state] ?? "Missing";
}
