/**
 * Wires password-field visibility toggles for provider credentials.
 */
export function registerSecretVisibilityToggles(buttons, documentRef = document) {
  for (const button of buttons) {
    button.addEventListener("click", () => {
      toggleSecretVisibility(button, documentRef);
    });
  }
}

function toggleSecretVisibility(button, documentRef) {
  const input = documentRef.getElementById(button.dataset.toggleSecret);
  if (!input) {
    return;
  }

  const shouldShow = input.type === "password";
  input.type = shouldShow ? "text" : "password";
  button.textContent = shouldShow ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(shouldShow));
}
