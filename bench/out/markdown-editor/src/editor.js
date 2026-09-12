"use strict";
/* Markleaf — markdown editor: live preview, view modes, unsaved-changes hint, real save. */

import { renderMarkdown } from "./markdown.js";

// ---- editor wiring
const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const dirty = document.querySelector("#dirty");
const savedNote = document.querySelector("#saved-note");
const saveBtn = document.querySelector("#save");
const modeButtons = Array.from(document.querySelectorAll(".modes button"));
const panes = document.querySelector(".panes");
const editPane = document.querySelector(".edit-pane");
const previewPane = document.querySelector(".preview-pane");

const DEFAULT_DOC = `# Welcome to Markleaf

Type on the left, watch the **live preview** on the right.

## Features

- headings \`# ## ###\`
- **bold**, *italic*, and \`inline code\`
- [links](https://example.com)
- fenced code blocks

\`\`\`js
function hello() { return "world"; }
\`\`\`

> A blockquote for docs and quotes.
`;

let savedSnapshot = DEFAULT_DOC;
editor.value = DEFAULT_DOC;

function render() {
  preview.innerHTML = renderMarkdown(editor.value);
}

function isDirty() {
  return editor.value !== savedSnapshot;
}

function updateDirty() {
  dirty.hidden = !isDirty();
  savedNote.hidden = true;
  saveBtn.disabled = !isDirty();
}

function save() {
  if (!isDirty()) return;
  savedSnapshot = editor.value;
  dirty.hidden = true;
  saveBtn.disabled = true;
  savedNote.hidden = false;
  setTimeout(() => { savedNote.hidden = true; }, 1600);
}

editor.addEventListener("input", () => { render(); updateDirty(); });
saveBtn.addEventListener("click", save);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
});

// unsaved-changes guard when leaving the page
window.addEventListener("beforeunload", (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---- view modes
function setMode(mode) {
  for (const b of modeButtons) b.classList.toggle("active", b.dataset.mode === mode);
  if (mode === "edit") {
    panes.style.gridTemplateColumns = "1fr";
    previewPane.style.display = "none";
    editPane.style.display = "block";
  } else if (mode === "preview") {
    panes.style.gridTemplateColumns = "1fr";
    editPane.style.display = "none";
    previewPane.style.display = "block";
  } else {
    panes.style.gridTemplateColumns = "1fr 1fr";
    editPane.style.display = "block";
    previewPane.style.display = "block";
  }
}
for (const b of modeButtons) b.addEventListener("click", () => setMode(b.dataset.mode));

render();
updateDirty();