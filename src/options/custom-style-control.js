import {
  BUILT_IN_STYLES,
  CUSTOM_STYLE_LIMITS,
  createCustomStyleId,
  normalizeCustomStyles
} from "../shared/settings.js";

const BUILT_IN_STYLE_IDS = new Set(BUILT_IN_STYLES.map((style) => style.id));

/**
 * Owns custom-style editing UI and keeps unsaved custom styles in memory.
 */
export function createCustomStyleController(elements, { onChange }) {
  let styles = [];
  let editingId = "";

  registerEvents();

  return {
    getStyles,
    setStyles,
    showError
  };

  function registerEvents() {
    elements.customStyleSave.addEventListener("click", saveDraft);
    elements.customStyleNew.addEventListener("click", clearDraft);
    elements.customStyleDelete.addEventListener("click", deleteSelectedStyle);

    for (const input of [elements.customStyleName, elements.customStyleInstructions]) {
      input.addEventListener("input", () => {
        showError("");
      });
    }
  }

  function getStyles() {
    return styles;
  }

  function setStyles(nextStyles) {
    styles = normalizeCustomStyles(nextStyles);
    if (!styles.some((style) => style.id === editingId)) {
      editingId = "";
      clearDraftFields();
    }

    renderList();
    syncDeleteButton();
  }

  function saveDraft() {
    const name = elements.customStyleName.value.trim();
    const instructions = elements.customStyleInstructions.value.trim();

    if (!name || !instructions) {
      showError("Custom styles need a name and instructions.");
      return;
    }

    const existingStyle = styles.find((style) => style.id === editingId);
    if (!existingStyle && styles.length >= CUSTOM_STYLE_LIMITS.maxCount) {
      showError(`You can save up to ${CUSTOM_STYLE_LIMITS.maxCount} custom styles.`);
      return;
    }

    const nextStyle = {
      id: existingStyle?.id ?? createAvailableStyleId(name),
      name,
      description: "",
      instructions
    };

    styles = existingStyle
      ? styles.map((style) => style.id === existingStyle.id ? nextStyle : style)
      : [...styles, nextStyle];
    styles = normalizeCustomStyles(styles);
    editingId = nextStyle.id;

    selectDraft(nextStyle.id);
    renderList();
    showError("");
    syncDeleteButton();
    onChange(styles);
  }

  function deleteSelectedStyle() {
    if (!editingId) {
      clearDraft();
      return;
    }

    const deletedId = editingId;
    styles = styles.filter((style) => style.id !== deletedId);
    clearDraftFields();
    renderList();
    syncDeleteButton();

    if (elements.defaultStyle.value === deletedId) {
      elements.defaultStyle.value = "default";
    }

    onChange(styles);
  }

  function clearDraft() {
    clearDraftFields();
    showError("");
    renderList();
    syncDeleteButton();
  }

  function clearDraftFields() {
    editingId = "";
    elements.customStyleId.value = "";
    elements.customStyleName.value = "";
    elements.customStyleInstructions.value = "";
  }

  function selectDraft(styleId) {
    const style = styles.find((item) => item.id === styleId);
    if (!style) {
      return;
    }

    editingId = style.id;
    elements.customStyleId.value = style.id;
    elements.customStyleName.value = style.name;
    elements.customStyleInstructions.value = style.instructions;
    showError("");
    renderList();
    syncDeleteButton();
  }

  function renderList() {
    elements.customStyleList.textContent = "";

    if (styles.length === 0) {
      const empty = elements.customStyleList.ownerDocument.createElement("p");
      empty.className = "custom-style-empty";
      empty.textContent = "No custom styles saved.";
      elements.customStyleList.append(empty);
      return;
    }

    for (const style of styles) {
      elements.customStyleList.append(createStyleRow(style));
    }
  }

  function createStyleRow(style) {
    const row = elements.customStyleList.ownerDocument.createElement("div");
    row.className = "custom-style-row";
    row.dataset.selected = style.id === editingId ? "true" : "false";
    row.setAttribute("role", "listitem");

    const text = elements.customStyleList.ownerDocument.createElement("div");
    const name = elements.customStyleList.ownerDocument.createElement("strong");
    const details = elements.customStyleList.ownerDocument.createElement("span");
    name.textContent = style.name;
    details.textContent = summarizeInstructions(style.instructions);
    text.append(name, details);

    const editButton = elements.customStyleList.ownerDocument.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => selectDraft(style.id));

    row.append(text, editButton);
    return row;
  }

  function createAvailableStyleId(name) {
    return createCustomStyleId(name, new Set([
      ...BUILT_IN_STYLE_IDS,
      ...styles.map((style) => style.id)
    ]));
  }

  function showError(message) {
    elements.customStyleName.setAttribute("aria-invalid", message ? "true" : "false");
    elements.customStyleInstructions.setAttribute("aria-invalid", message ? "true" : "false");
    elements.customStyleError.textContent = message || "";
  }

  function syncDeleteButton() {
    elements.customStyleDelete.disabled = !editingId;
  }
}

function summarizeInstructions(instructions) {
  const normalized = instructions.replace(/\s+/g, " ").trim();
  if (normalized.length <= CUSTOM_STYLE_LIMITS.descriptionMaxLength) {
    return normalized;
  }

  return `${normalized.slice(0, CUSTOM_STYLE_LIMITS.descriptionMaxLength - 1)}...`;
}
