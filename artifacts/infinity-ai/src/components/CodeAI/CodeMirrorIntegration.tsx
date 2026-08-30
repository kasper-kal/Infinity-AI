/**
 * CodeMirror Extensions for Cursor AI Features
 * - TabAutocomplete: Ghost text inline completions
 * - CmdKEdit: Inline edit palette at cursor
 */

import { Extension, StateField, StateEffect, Facet } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";
import { useTabAutocomplete, useCmdKEdit } from ".";

// ============================================
// Tab Autocomplete Extension
// ============================================

interface TabAutocompleteConfig {
  projectId: string;
  projectRoot: string;
  language: string;
  filePath: string;
  enabled: boolean;
}

const TabAutocompleteConfigFacet = Facet.define<TabAutocompleteConfig, TabAutocompleteConfig>({
  combine(configs) {
    return configs[configs.length - 1] || { projectId: "", projectRoot: "", language: "", filePath: "", enabled: false };
  },
});

const tabAutocompleteState = StateField.define<{
  suggestion: string | null;
  showGhost: boolean;
  isLoading: boolean;
  position: { top: number; left: number } | null;
}>({
  create() {
    return { suggestion: null, showGhost: false, isLoading: false, position: null };
  },
  update(value, tr) {
    // State updates handled by view plugin
    return value;
  },
});

function createTabAutocompleteExtension(config: TabAutocompleteConfig): Extension {
  return [
    TabAutocompleteConfigFacet.of(config),
    tabAutocompleteState,
    ViewPlugin.fromClass(class {
      suggestion: string | null = null;
      showGhost = false;
      isLoading = false;
      debounceTimer: ReturnType<typeof setTimeout> | null = null;
      lastRequestKey = "";

      constructor(readonly view: EditorView) {}

      async requestCompletion() {
        const config = this.view.state.facet(TabAutocompleteConfigFacet);
        if (!config.enabled) return;

        const state = this.view.state;
        const cursor = state.selection.main.head;
        const doc = state.doc.toString();
        const prefix = doc.slice(0, cursor);
        const suffix = doc.slice(cursor);

        const requestKey = `${prefix.slice(-200)}|${suffix.slice(0, 100)}|${config.language}|${config.filePath}`;
        if (requestKey === this.lastRequestKey) return;
        this.lastRequestKey = requestKey;

        if (prefix.trim().length < 3 && suffix.trim().length < 3) {
          this.suggestion = null;
          this.showGhost = false;
          this.view.dispatch({ effects: updateTabState.of({ suggestion: null, showGhost: false }) });
          return;
        }

        this.isLoading = true;
        this.view.dispatch({ effects: updateTabState.of({ isLoading: true }) });

        try {
          const response = await fetch("/api/infinity/cursor/tab", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: config.projectId,
              projectRoot: config.projectRoot,
              prefix: prefix.slice(-1000),
              suffix: suffix.slice(0, 1000),
              filePath: config.filePath,
              language: config.language,
              maxTokens: 200,
            }),
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Completion failed");

          if (data.completion && data.completion.trim().length > 0) {
            this.suggestion = data.completion;
            this.showGhost = true;
            this.view.dispatch({ effects: updateTabState.of({ suggestion: data.completion, showGhost: true, isLoading: false }) });
          } else {
            this.suggestion = null;
            this.showGhost = false;
            this.view.dispatch({ effects: updateTabState.of({ suggestion: null, showGhost: false, isLoading: false }) });
          }
        } catch (error) {
          console.error("Tab autocomplete error:", error);
          this.suggestion = null;
          this.showGhost = false;
          this.view.dispatch({ effects: updateTabState.of({ suggestion: null, showGhost: false, isLoading: false }) });
        }
      }

      handleChange() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.requestCompletion(), 150);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.handleChange();
        }
      }

      destroy() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
      }
    }, {
      decorations: (plugin) => {
        const state = plugin.view.state.field(tabAutocompleteState);
        if (!state.suggestion || !state.showGhost) return Decoration.none;

        const cursor = plugin.view.state.selection.main.head;
        const coords = plugin.view.coordsAtPos(cursor);

        return Decoration.set([
          Decoration.widget({
            widget: new GhostTextWidget(state.suggestion, coords),
            side: 1,
          }).range(cursor),
        ]);
      },
    }),
    keymap.of([
      {
        key: "Tab",
        run(view) {
          const state = view.state.field(tabAutocompleteState);
          if (state.suggestion && state.showGhost) {
            view.dispatch({
              changes: { from: view.state.selection.main.head, insert: state.suggestion },
              effects: updateTabState.of({ suggestion: null, showGhost: false, isLoading: false }),
            });
            return true;
          }
          return false;
        },
      },
      {
        key: "Escape",
        run(view) {
          const state = view.state.field(tabAutocompleteState);
          if (state.showGhost) {
            view.dispatch({ effects: updateTabState.of({ suggestion: null, showGhost: false, isLoading: false }) });
            return true;
          }
          return false;
        },
      },
    ]),
  ];
}

const updateTabState = StateEffect.define<{
  suggestion: string | null;
  showGhost: boolean;
  isLoading?: boolean;
}>();

class GhostTextWidget {
  constructor(
    readonly text: string,
    readonly coords: { top: number; left: number; bottom: number; right: number }
  ) {}

  eq(other: GhostTextWidget) {
    return other.text === this.text && other.coords.top === this.coords.top;
  }

  toDOM() {
    const el = document.createElement("span");
    el.style.cssText = `
      position: absolute;
      top: ${this.coords.top}px;
      left: ${this.coords.left}px;
      pointer-events: none;
      z-index: 10;
      color: var(--gray-9);
      opacity: 0.6;
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-width: 400px;
      max-height: 200px;
      overflow: hidden;
      text-shadow: 0 0 2px var(--gray-1);
    `;
    el.textContent = this.text;
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

// ============================================
// Cmd+K Inline Edit Extension
// ============================================

interface CmdKEditConfig {
  projectId: string;
  projectRoot: string;
  language: string;
  filePath: string;
  onAccept: (newCode: string) => void;
  onClose: () => void;
}

const CmdKEditConfigFacet = Facet.define<CmdKEditConfig, CmdKEditConfig>({
  combine(configs) {
    return configs[configs.length - 1] || { projectId: "", projectRoot: "", language: "", filePath: "", onAccept: () => {}, onClose: () => {} };
  },
});

const cmdKEditState = StateField.define<{
  isOpen: boolean;
  instruction: string;
  result: { replacement: string; original: string } | null;
  isGenerating: boolean;
  showDiff: boolean;
  diffView: "side-by-side" | "unified";
  history: Array<{ replacement: string; original: string }>;
  historyIndex: number;
}>({
  create() {
    return { isOpen: false, instruction: "", result: null, isGenerating: false, showDiff: true, diffView: "side-by-side", history: [], historyIndex: -1 };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(cmdKOpen)) {
        return { ...value, isOpen: true, instruction: "", result: null };
      }
      if (effect.is(cmdKClose)) {
        return { ...value, isOpen: false };
      }
      if (effect.is(cmdKSetInstruction)) {
        return { ...value, instruction: effect.value };
      }
      if (effect.is(cmdKSetResult)) {
        const newHistory = [...value.history.slice(0, value.historyIndex + 1), effect.value];
        return { ...value, result: effect.value, history: newHistory, historyIndex: newHistory.length - 1 };
      }
      if (effect.is(cmdKSetGenerating)) {
        return { ...value, isGenerating: effect.value };
      }
      if (effect.is(cmdKSetShowDiff)) {
        return { ...value, showDiff: effect.value };
      }
      if (effect.is(cmdKSetDiffView)) {
        return { ...value, diffView: effect.value };
      }
      if (effect.is(cmdKNavigateHistory)) {
        const newIndex = effect.value === "prev" ? Math.max(0, value.historyIndex - 1) : Math.min(value.history.length - 1, value.historyIndex + 1);
        return { ...value, historyIndex: newIndex, result: value.history[newIndex] };
      }
      if (effect.is(cmdKAccept)) {
        return { ...value, isOpen: false };
      }
    }
    return value;
  },
});

const cmdKOpen = StateEffect.define<void>();
const cmdKClose = StateEffect.define<void>();
const cmdKSetInstruction = StateEffect.define<string>();
const cmdKSetResult = StateEffect.define<{ replacement: string; original: string }>();
const cmdKSetGenerating = StateEffect.define<boolean>();
const cmdKSetShowDiff = StateEffect.define<boolean>();
const cmdKSetDiffView = StateEffect.define<"side-by-side" | "unified">();
const cmdKNavigateHistory = StateEffect.define<"prev" | "next">();
const cmdKAccept = StateEffect.define<void>();

function createCmdKEditExtension(config: CmdKEditConfig): Extension {
  return [
    CmdKEditConfigFacet.of(config),
    cmdKEditState,
    ViewPlugin.fromClass(class {
      panelEl: HTMLDivElement | null = null;

      constructor(readonly view: EditorView) {}

      open() {
        this.view.dispatch({ effects: cmdKOpen.of(null) });
        this.renderPanel();
      }

      close() {
        this.view.dispatch({ effects: cmdKClose.of(null) });
        this.removePanel();
      }

      async generate() {
        const state = this.view.state.field(cmdKEditState);
        const config = this.view.state.facet(CmdKEditConfigFacet);
        if (!state.instruction.trim() || state.isGenerating) return;

        this.view.dispatch({ effects: cmdKSetGenerating.of(true) });
        this.view.dispatch({ effects: cmdKSetResult.of({ replacement: "", original: "" }) });

        const selectedCode = this.getSelectedCode();

        try {
          const response = await fetch("/api/infinity/cursor/cmd-k", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: config.projectId,
              projectRoot: config.projectRoot,
              instruction: state.instruction,
              filePath: config.filePath,
              selectedCode,
              language: config.language,
            }),
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Edit failed");

          const editResult = { replacement: data.replacement, original: selectedCode };
          this.view.dispatch({ effects: cmdKSetResult.of(editResult) });
        } catch (error) {
          console.error("Cmd+K error:", error);
          this.view.dispatch({ effects: cmdKSetResult.of({ replacement: `Error: ${error}`, original: selectedCode }) });
        } finally {
          this.view.dispatch({ effects: cmdKSetGenerating.of(false) });
        }
        this.renderPanel();
      }

      getSelectedCode(): string {
        const view = this.view;
        const start = view.state.selection.main.from;
        const end = view.state.selection.main.to;

        if (start === end) {
          // No selection - get current line
          const doc = view.state.doc.toString();
          const lineStart = doc.lastIndexOf("\n", start - 1) + 1;
          const lineEnd = doc.indexOf("\n", start);
          return doc.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        }

        return view.state.doc.sliceString(start, end);
      }

      getCursorPosition() {
        const view = this.view;
        const coords = view.coordsAtPos(view.state.selection.main.head);
        return { top: coords.bottom + 8, left: Math.min(coords.left, view.dom.clientWidth - 420) };
      }

      accept() {
        const state = this.view.state.field(cmdKEditState);
        const config = this.view.state.facet(CmdKEditConfigFacet);
        if (state.result) {
          config.onAccept(state.result.replacement);
          this.close();
        }
      }

      reject() {
        this.view.dispatch({ effects: [cmdKSetResult.of({ replacement: "", original: "" }), cmdKSetInstruction.of("")] });
        this.renderPanel();
      }

      navigateHistory(direction: "prev" | "next") {
        this.view.dispatch({ effects: cmdKNavigateHistory.of(direction) });
        this.renderPanel();
      }

      setInstruction(instruction: string) {
        this.view.dispatch({ effects: cmdKSetInstruction.of(instruction) });
      }

      toggleShowDiff() {
        const state = this.view.state.field(cmdKEditState);
        this.view.dispatch({ effects: cmdKSetShowDiff.of(!state.showDiff) });
        this.renderPanel();
      }

      toggleDiffView() {
        const state = this.view.state.field(cmdKEditState);
        this.view.dispatch({ effects: cmdKSetDiffView.of(state.diffView === "side-by-side" ? "unified" : "side-by-side") });
        this.renderPanel();
      }

      renderPanel() {
        this.removePanel();
        const state = this.view.state.field(cmdKEditState);
        if (!state.isOpen) return;

        const config = this.view.state.facet(CmdKEditConfigFacet);
        const pos = this.getCursorPosition();

        this.panelEl = document.createElement("div");
        this.panelEl.style.cssText = `
          position: fixed;
          top: ${pos.top}px;
          left: ${Math.max(0, pos.left)}px;
          z-index: 10000;
          pointer-events: auto;
          font-family: var(--font-sans);
        `;

        this.panelEl.innerHTML = this.renderPanelHTML(state, config);
        document.body.appendChild(this.panelEl);
        this.attachListeners(state, config);
      }

      renderPanelHTML(state: any, config: CmdKEditConfig): string {
        const selectedCode = this.getSelectedCode();
        const hasResult = state.result && state.result.replacement;

        return `
          <div style="
            width: 420px;
            max-width: calc(100vw - 20px);
            background: var(--gray-1);
            border: 1px solid var(--gray-5);
            border-radius: 12px;
            box-shadow: var(--shadow-xl);
            overflow: hidden;
            animation: popIn 0.15s ease-out;
          ">
            <style>
              @keyframes popIn { from { opacity: 0; transform: scale(0.95) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            </style>

            <!-- Header -->
            <div style="padding: 10px 12px; border-bottom: 1px solid var(--gray-5); background: var(--gray-2); display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-flex; align-items: center; gap: 4px; background: var(--violet-3); color: var(--violet-11); padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  Cmd+K
                </span>
                <span style="font-size: 12px; color: var(--gray-10);">${config.filePath}</span>
              </div>
              <div style="display: flex; gap: 4px;">
                <button class="cmdk-close" style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--gray-10);" title="Close (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
            </div>

            <!-- Instruction Input -->
            <div style="padding: 12px; border-bottom: 1px solid var(--gray-5);">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    class="cmdk-instruction"
                    type="text"
                    value="${state.instruction}"
                    placeholder="Describe the change... (e.g., 'Add error handling', 'Convert to async/await')"
                    style="flex: 1; min-width: 0; padding: 8px 12px; background: var(--gray-2); border: 1px solid var(--gray-5); border-radius: 6px; font-size: 13px; color: var(--gray-12);"
                  />
                  <button
                    class="cmdk-generate"
                    ${state.isGenerating || !state.instruction.trim() ? "disabled" : ""}
                    style="padding: 8px 16px; background: var(--violet-9); color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px;"
                  >
                    ${state.isGenerating ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'}
                    ${state.isGenerating ? "Generating..." : "Generate"}
                  </button>
                </div>

                <div style="display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--gray-10);">
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" class="cmdk-show-diff" ${state.showDiff ? "checked" : ""} /> Show diff
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" class="cmdk-diff-view" ${state.diffView === "side-by-side" ? "checked" : ""} /> Side-by-side
                  </label>
                  ${state.history.length > 1 ? `
                    <div style="display: flex; align-items: center; gap: 4px;">
                      <button class="cmdk-hist-prev" ${state.historyIndex === 0 ? "disabled" : ""} style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--gray-10);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
                      <span>${state.historyIndex + 1}/${state.history.length}</span>
                      <button class="cmdk-hist-next" ${state.historyIndex === state.history.length - 1 ? "disabled" : ""} style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--gray-10);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
                    </div>
                  ` : ""}
                </div>
              </div>
            </div>

            ${selectedCode ? `
              <!-- Selected Code Context -->
              <div style="padding: 8px 12px; border-bottom: 1px solid var(--gray-5); background: var(--gray-2); max-height: 150px; overflow: auto;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                  <span style="font-size: 12px; font-weight: 500; color: var(--gray-11);">Selected Code</span>
                  <span style="background: var(--gray-4); color: var(--gray-11); padding: 1px 6px; border-radius: 9999px; font-size: 10px;">${selectedCode.split("\n").length} lines</span>
                </div>
                <pre style="margin: 0; padding: 8px; background: var(--gray-3); border-radius: 6px; max-height: 100px; overflow: auto;">
                  <code style="font-family: monospace; font-size: 11px; line-height: 1.5; color: var(--gray-12); white-space: pre-wrap;">${this.escapeHtml(selectedCode)}</code>
                </pre>
              </div>
            ` : ""}

            ${hasResult ? `
              <!-- Result / Diff Preview -->
              <div style="padding: 12px; max-height: 400px; overflow: auto;">
                ${state.showDiff && state.result.replacement !== state.result.original ? this.renderDiff(state.result.original, state.result.replacement, config.language, state.diffView) : `
                  <div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                      <span style="font-size: 12px; font-weight: 500; color: var(--gray-11);">Replacement</span>
                      <button class="cmdk-copy" style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--gray-10);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                    </div>
                    <pre style="margin: 0; padding: 12px; background: var(--gray-2); border-radius: 8px; max-height: 300px; overflow: auto;">
                      <code style="font-family: monospace; font-size: 12px; line-height: 1.5; color: var(--gray-12); white-space: pre-wrap;">${this.escapeHtml(state.result.replacement)}</code>
                    </pre>
                  </div>
                `}

                <!-- Accept/Reject Buttons -->
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
                  <button class="cmdk-reject" style="padding: 8px 16px; background: var(--red-3); color: var(--red-11); border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Reject
                  </button>
                  <button class="cmdk-accept" style="padding: 8px 20px; background: var(--green-9); color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; min-width: 120px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    Accept & Apply
                  </button>
                </div>
              </div>
            ` : ""}

            ${!hasResult && !state.isGenerating ? `
              <!-- Empty State -->
              <div style="padding: 24px; text-align: center; color: var(--gray-10);">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 8px;"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                <div style="font-weight: 500; font-size: 14px; margin-bottom: 4px; color: var(--gray-11);">What would you like to change?</div>
                <div style="font-size: 13px;">Describe your edit in natural language.</div>
                <div style="display: flex; justify-content: center; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                  <button class="cmdk-suggestion" data-inst="Add error handling" style="padding: 6px 12px; background: var(--gray-3); border: 1px solid var(--gray-5); border-radius: 6px; font-size: 11px; cursor: pointer;">Error handling</button>
                  <button class="cmdk-suggestion" data-inst="Convert to async/await" style="padding: 6px 12px; background: var(--gray-3); border: 1px solid var(--gray-5); border-radius: 6px; font-size: 11px; cursor: pointer;">Async/await</button>
                  <button class="cmdk-suggestion" data-inst="Add TypeScript types" style="padding: 6px 12px; background: var(--gray-3); border: 1px solid var(--gray-5); border-radius: 6px; font-size: 11px; cursor: pointer;">Add types</button>
                  <button class="cmdk-suggestion" data-inst="Optimize performance" style="padding: 6px 12px; background: var(--gray-3); border: 1px solid var(--gray-5); border-radius: 6px; font-size: 11px; cursor: pointer;">Optimize</button>
                </div>
              </div>
            ` : ""}

            ${state.isGenerating && !hasResult ? `
              <!-- Generating State -->
              <div style="padding: 24px; text-align: center;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--violet-9)" stroke-width="2" style="animation: spin 1s linear infinite; margin-bottom: 12px;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg>
                <div style="font-weight: 500; font-size: 14px; color: var(--gray-11); margin-bottom: 4px;">Generating edit...</div>
                <div style="font-size: 13px; color: var(--gray-10);">${this.escapeHtml(state.instruction)}</div>
              </div>
            ` : ""}
          </div>
        `;
      }

      renderDiff(original: string, replacement: string, language: string, view: "side-by-side" | "unified"): string {
        const origLines = original.split("\n");
        const newLines = replacement.split("\n");

        if (view === "side-by-side") {
          return `
            <div style="display: flex; gap: 0; border: 1px solid var(--gray-5); border-radius: 8px; overflow: hidden;">
              <div style="flex: 1; background: var(--red-1); border-right: 1px solid var(--gray-5); min-width: 0;">
                <div style="padding: 6px 10px; background: var(--red-2); border-bottom: 1px solid var(--gray-5); display: flex; align-items: center; justify-content: space-between;">
                  <span style="font-size: 11px; font-weight: 500; color: var(--red-11);">Original</span>
                  <span style="background: var(--red-3); color: var(--red-11); padding: 1px 6px; border-radius: 9999px; font-size: 10px;">${origLines.length} lines</span>
                </div>
                <pre style="margin: 0; padding: 10px; max-height: 300px; overflow: auto; font-size: 11px; line-height: 1.6;">
                  <code style="color: var(--red-12); font-family: monospace;">${origLines.map((line, i) => `<div style="display: flex; gap: 6px;"><span style="color: var(--gray-9); user-select: none; min-width: 24px; text-align: right; font-size: 10px;">${i + 1}</span><span>${this.escapeHtml(line || " ")}</span></div>`).join("")}</code>
                </pre>
              </div>
              <div style="flex: 1; background: var(--green-1); min-width: 0;">
                <div style="padding: 6px 10px; background: var(--green-2); border-bottom: 1px solid var(--gray-5); display: flex; align-items: center; justify-content: space-between;">
                  <span style="font-size: 11px; font-weight: 500; color: var(--green-11);">New</span>
                  <span style="background: var(--green-3); color: var(--green-11); padding: 1px 6px; border-radius: 9999px; font-size: 10px;">${newLines.length} lines</span>
                </div>
                <pre style="margin: 0; padding: 10px; max-height: 300px; overflow: auto; font-size: 11px; line-height: 1.6;">
                  <code style="color: var(--green-12); font-family: monospace;">${newLines.map((line, i) => `<div style="display: flex; gap: 6px;"><span style="color: var(--gray-9); user-select: none; min-width: 24px; text-align: right; font-size: 10px;">${i + 1}</span><span>${this.escapeHtml(line || " ")}</span></div>`).join("")}</code>
                </pre>
              </div>
            </div>
          `;
        }

        // Unified diff
        const diffLines = this.computeUnifiedDiff(origLines, newLines);
        return `
          <div style="border: 1px solid var(--gray-5); border-radius: 8px; overflow: hidden;">
            <div style="padding: 6px 10px; background: var(--gray-2); border-bottom: 1px solid var(--gray-5); display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 11px; font-weight: 500; color: var(--gray-11);">Unified Diff</span>
              <span style="background: var(--gray-4); color: var(--gray-11); padding: 1px 6px; border-radius: 9999px; font-size: 10px;">${diffLines.length} lines</span>
            </div>
            <pre style="margin: 0; padding: 10px; max-height: 300px; overflow: auto; font-size: 11px; line-height: 1.6; background: var(--gray-1);">
              <code style="font-family: monospace;">${diffLines.map((line, i) => `<div style="display: flex; gap: 6px; background: ${line.startsWith("+") ? "var(--green-1)" : line.startsWith("-") ? "var(--red-1)" : line.startsWith("@@") ? "var(--blue-1)" : "transparent"}; color: ${line.startsWith("+") ? "var(--green-11)" : line.startsWith("-") ? "var(--red-11)" : line.startsWith("@@") ? "var(--blue-11)" : "var(--gray-12)"};"><span style="user-select: none; min-width: 24px; text-align: right; color: var(--gray-9); font-size: 10px;">${i + 1}</span><span>${this.escapeHtml(line || " ")}</span></div>`).join("")}</code>
            </pre>
          </div>
        `;
      }

      computeUnifiedDiff(original: string[], updated: string[]): string[] {
        const diffLines: string[] = [];
        diffLines.push(`--- original`);
        diffLines.push(`+++ updated`);

        let i = 0, j = 0;
        while (i < original.length || j < updated.length) {
          if (i < original.length && j < updated.length && original[i] === updated[j]) {
            diffLines.push(` ${original[i]}`);
            i++; j++;
          } else if (j < updated.length && (i >= original.length || original[i] !== updated[j])) {
            diffLines.push(`+${updated[j]}`);
            j++;
          } else if (i < original.length) {
            diffLines.push(`-${original[i]}`);
            i++;
          }
        }
        return diffLines;
      }

      escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }

      attachListeners(state: any, config: CmdKEditConfig) {
        if (!this.panelEl) return;

        const closeBtn = this.panelEl.querySelector(".cmdk-close");
        const generateBtn = this.panelEl.querySelector(".cmdk-generate");
        const instructionInput = this.panelEl.querySelector(".cmdk-instruction") as HTMLInputElement;
        const showDiffCheckbox = this.panelEl.querySelector(".cmdk-show-diff") as HTMLInputElement;
        const diffViewCheckbox = this.panelEl.querySelector(".cmdk-diff-view") as HTMLInputElement;
        const histPrev = this.panelEl.querySelector(".cmdk-hist-prev");
        const histNext = this.panelEl.querySelector(".cmdk-hist-next");
        const acceptBtn = this.panelEl.querySelector(".cmdk-accept");
        const rejectBtn = this.panelEl.querySelector(".cmdk-reject");
        const copyBtn = this.panelEl.querySelector(".cmdk-copy");
        const suggestionBtns = this.panelEl.querySelectorAll(".cmdk-suggestion");

        closeBtn?.addEventListener("click", () => this.close());
        generateBtn?.addEventListener("click", () => this.generate());
        acceptBtn?.addEventListener("click", () => this.accept());
        rejectBtn?.addEventListener("click", () => this.reject());
        copyBtn?.addEventListener("click", () => {
          if (state.result) navigator.clipboard.writeText(state.result.replacement);
        });
        showDiffCheckbox?.addEventListener("change", () => this.toggleShowDiff());
        diffViewCheckbox?.addEventListener("change", () => this.toggleDiffView());
        histPrev?.addEventListener("click", () => this.navigateHistory("prev"));
        histNext?.addEventListener("click", () => this.navigateHistory("next"));
        instructionInput?.addEventListener("input", (e) => this.setInstruction((e.target as HTMLInputElement).value));
        instructionInput?.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            this.generate();
          }
        });
        suggestionBtns?.forEach(btn => {
          btn.addEventListener("click", () => {
            const inst = (btn as HTMLElement).dataset.inst;
            if (inst) {
              this.setInstruction(inst);
              setTimeout(() => this.generate(), 50);
            }
          });
        });
      }

      removePanel() {
        if (this.panelEl) {
          this.panelEl.remove();
          this.panelEl = null;
        }
      }

      destroy() {
        this.removePanel();
      }
    }),
    keymap.of([
      {
        key: "Mod-k",
        run(view) {
          const state = view.state.field(cmdKEditState);
          if (state.isOpen) {
            view.dispatch({ effects: cmdKClose.of(null) });
          } else {
            // Open via plugin
            const plugin = view.plugin(cmdKPluginKey);
            plugin?.open();
          }
          return true;
        },
      },
      {
        key: "Escape",
        run(view) {
          const state = view.state.field(cmdKEditState);
          if (state.isOpen) {
            if (state.result) {
              view.dispatch({ effects: [cmdKSetResult.of({ replacement: "", original: "" }), cmdKSetInstruction.of("")] });
            } else {
              view.dispatch({ effects: cmdKClose.of(null) });
            }
            return true;
          }
          return false;
        },
      },
      {
        key: "Mod-Enter",
        run(view) {
          const state = view.state.field(cmdKEditState);
          if (state.isOpen && !state.isGenerating) {
            if (state.result) {
              const plugin = view.plugin(cmdKPluginKey);
              plugin?.accept();
            } else {
              const plugin = view.plugin(cmdKPluginKey);
              plugin?.generate();
            }
            return true;
          }
          return false;
        },
      },
      {
        key: "ArrowUp",
        run(view) {
          const state = view.state.field(cmdKEditState);
          if (state.isOpen && state.result && state.historyIndex > 0) {
            const plugin = view.plugin(cmdKPluginKey);
            plugin?.navigateHistory("prev");
            return true;
          }
          return false;
        },
      },
      {
        key: "ArrowDown",
        run(view) {
          const state = view.state.field(cmdKEditState);
          if (state.isOpen && state.result && state.historyIndex < state.history.length - 1) {
            const plugin = view.plugin(cmdKPluginKey);
            plugin?.navigateHistory("next");
            return true;
          }
          return false;
        },
      },
    ]),
  ];
}

const cmdKPluginKey = ViewPlugin.define(() => ({})).key;

// ============================================
// Code Navigation Extension (Go to Definition, Find References)
// ============================================

interface CodeNavigationConfig {
  projectId: string;
  projectRoot: string;
  language: string;
  filePath: string;
  onNavigate?: (filePath: string, line: number, column?: number) => void;
}

const CodeNavigationConfigFacet = Facet.define<CodeNavigationConfig, CodeNavigationConfig>({
  combine(configs) {
    return configs[configs.length - 1] || { projectId: "", projectRoot: "", language: "", filePath: "", onNavigate: undefined };
  },
});

interface NavigationResult {
  file: string;
  filePath: string;
  language: string;
  type: string;
  name: string;
  signature?: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
  matchType?: string;
}

const codeNavState = StateField.define<{
  showTooltip: boolean;
  tooltipPos: number | null;
  tooltipContent: string | null;
  results: NavigationResult[];
  isLoading: boolean;
  mode: "definition" | "references" | null;
}>({
  create() {
    return { showTooltip: false, tooltipPos: null, tooltipContent: null, results: [], isLoading: false, mode: null };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(showNavTooltip)) {
        return { ...value, showTooltip: true, tooltipPos: effect.value.pos, tooltipContent: effect.value.content, mode: effect.value.mode };
      }
      if (effect.is(hideNavTooltip)) {
        return { ...value, showTooltip: false, tooltipPos: null, tooltipContent: null, mode: null };
      }
      if (effect.is(setNavResults)) {
        return { ...value, results: effect.value.results, isLoading: false };
      }
      if (effect.is(setNavLoading)) {
        return { ...value, isLoading: effect.value, results: effect.value ? [] : value.results };
      }
    }
    return value;
  },
});

const showNavTooltip = StateEffect.define<{ pos: number; content: string; mode: "definition" | "references" }>();
const hideNavTooltip = StateEffect.define<void>();
const setNavResults = StateEffect.define<{ results: NavigationResult[] }>();
const setNavLoading = StateEffect.define<boolean>();

async function searchDefinition(config: CodeNavigationConfig, symbol: string): Promise<NavigationResult[]> {
  try {
    const response = await fetch(`/api/infinity/codebase/search/symbol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: config.projectId, symbol, limit: 10 }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("Definition search error:", error);
    return [];
  }
}

async function searchReferences(config: CodeNavigationConfig, symbol: string): Promise<NavigationResult[]> {
  try {
    const response = await fetch(`/api/infinity/codebase/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: config.projectId,
        query: symbol,
        limit: 20,
        hybrid: true,
        types: ["function", "class", "interface", "type"],
      }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("References search error:", error);
    return [];
  }
}

function getSymbolAtPosition(view: EditorView, pos: number): string | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const col = pos - line.from;

  // Find word boundaries
  let start = col;
  let end = col;
  while (start > 0 && /[\w$]/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /[\w$]/.test(lineText[end])) end++;

  if (start === end) return null;
  return lineText.slice(start, end);
}

function createCodeNavigationExtension(config: CodeNavigationConfig): Extension {
  return [
    CodeNavigationConfigFacet.of(config),
    codeNavState,
    ViewPlugin.fromClass(class {
      tooltipEl: HTMLDivElement | null = null;
      lastHoverPos: number | null = null;
      hoverTimer: ReturnType<typeof setTimeout> | null = null;

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        // Clear hover timer on scroll/doc change
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
          }
        }
      }

      async showDefinition(pos: number) {
        const config = this.view.state.facet(CodeNavigationConfigFacet);
        const symbol = getSymbolAtPosition(this.view, pos);
        if (!symbol) return;

        this.view.dispatch({ effects: setNavLoading.of(true) });
        const results = await searchDefinition(config, symbol);

        if (results.length === 0) {
          this.view.dispatch({ effects: setNavResults.of({ results: [] }) });
          this.showTooltipAt(pos, `No definition found for "${symbol}"`, "definition");
          return;
        }

        this.view.dispatch({ effects: setNavResults.of({ results }) });

        // Show tooltip for first result (definition)
        const def = results[0];
        const content = this.formatTooltip(def, "definition");
        this.showTooltipAt(pos, content, "definition");
      }

      async showReferences(pos: number) {
        const config = this.view.state.facet(CodeNavigationConfigFacet);
        const symbol = getSymbolAtPosition(this.view, pos);
        if (!symbol) return;

        this.view.dispatch({ effects: setNavLoading.of(true) });
        const results = await searchReferences(config, symbol);

        this.view.dispatch({ effects: setNavResults.of({ results }) });

        if (results.length === 0) {
          this.showTooltipAt(pos, `No references found for "${symbol}"`, "references");
          return;
        }

        const content = this.formatReferencesTooltip(results, symbol);
        this.showTooltipAt(pos, content, "references");
      }

      formatTooltip(result: NavigationResult, mode: "definition" | "references"): string {
        const relPath = result.file;
        return `
          <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.5;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <span style="background: var(--violet-3); color: var(--violet-11); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">${mode === "definition" ? "Definition" : "Reference"}</span>
              <span style="color: var(--gray-11); font-weight: 500;">${result.name}</span>
            </div>
            <div style="color: var(--gray-10); font-size: 11px; margin-bottom: 4px;">${relPath}:${result.startLine}</div>
            ${result.signature ? `<div style="font-family: var(--font-mono); font-size: 11px; color: var(--gray-11); background: var(--gray-3); padding: 6px; border-radius: 4px; overflow-x: auto; white-space: pre; max-width: 400px;">${this.escapeHtml(result.signature)}</div>` : ""}
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--gray-5); font-size: 10px; color: var(--gray-9);">
              Press <kbd style="background: var(--gray-3); padding: 1px 4px; border-radius: 3px;">Enter</kbd> to go to definition
              ${mode === "references" ? ` | ${results.length} references found` : ""}
            </div>
          </div>
        `;
      }

      formatReferencesTooltip(results: NavigationResult[], symbol: string): string {
        const items = results.slice(0, 10).map(r =>
          `<div style="padding: 4px 8px; border-radius: 4px; cursor: pointer; font-family: var(--font-mono); font-size: 11px; color: var(--gray-11);" data-file="${r.filePath}" data-line="${r.startLine}">${r.file}:${r.startLine} - ${r.signature || r.name}</div>`
        ).join("");
        return `
          <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.5; max-height: 300px; overflow-y: auto;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
              <span style="background: var(--blue-3); color: var(--blue-11); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">References</span>
              <span style="color: var(--gray-11); font-weight: 500;">${symbol}</span>
              <span style="background: var(--gray-4); color: var(--gray-11); padding: 1px 6px; border-radius: 9999px; font-size: 10px;">${results.length} found</span>
            </div>
            <div>${items}</div>
            ${results.length > 10 ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--gray-5); font-size: 10px; color: var(--gray-9);">Showing 10 of ${results.length} references</div>` : ""}
          </div>
        `;
      }

      escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }

      showTooltipAt(pos: number, content: string, mode: "definition" | "references") {
        const coords = this.view.coordsAtPos(pos);
        this.view.dispatch({ effects: showNavTooltip.of({ pos, content, mode }) });
      }

      handleNavigate(result: NavigationResult) {
        const config = this.view.state.facet(CodeNavigationConfigFacet);
        if (config.onNavigate) {
          config.onNavigate(result.filePath, result.startLine, 1);
        }
      }

      destroy() {
        if (this.hoverTimer) clearTimeout(this.hoverTimer);
        this.removeTooltip();
      }

      removeTooltip() {
        if (this.tooltipEl) {
          this.tooltipEl.remove();
          this.tooltipEl = null;
        }
      }
    }, {
      decorations: (plugin) => {
        const state = plugin.view.state.field(codeNavState);
        if (!state.showTooltip || state.tooltipPos === null || !state.tooltipContent) return Decoration.none;

        return Decoration.set([
          Decoration.widget({
            widget: new NavTooltipWidget(state.tooltipContent, state.tooltipPos, plugin.view, plugin),
            side: 1,
          }).range(state.tooltipPos),
        ]);
      },
    }),
    keymap.of([
      {
        key: "F12",
        run(view) {
          const plugin = view.plugin(navPluginKey);
          if (plugin) {
            const pos = view.state.selection.main.head;
            plugin.showDefinition(pos);
            return true;
          }
          return false;
        },
      },
      {
        key: "Shift-F12",
        run(view) {
          const plugin = view.plugin(navPluginKey);
          if (plugin) {
            const pos = view.state.selection.main.head;
            plugin.showReferences(pos);
            return true;
          }
          return false;
        },
      },
      {
        key: "Mod-Click",
        run(view) {
          const plugin = view.plugin(navPluginKey);
          if (plugin) {
            // This is handled by mouse event listener in widget
            return false;
          }
          return false;
        },
      },
      {
        key: "Escape",
        run(view) {
          const state = view.state.field(codeNavState);
          if (state.showTooltip) {
            view.dispatch({ effects: hideNavTooltip.of(null) });
            return true;
          }
          return false;
        },
      },
    ]),
  ];
}

const navPluginKey = ViewPlugin.define(() => ({})).key;

class NavTooltipWidget {
  constructor(
    readonly content: string,
    readonly pos: number,
    readonly view: EditorView,
    readonly plugin: any
  ) {}

  eq(other: NavTooltipWidget) {
    return other.content === this.content && other.pos === this.pos;
  }

  toDOM() {
    const el = document.createElement("div");
    el.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: auto;
      z-index: 100;
      max-width: 500px;
    `;
    el.innerHTML = this.content;

    // Position the tooltip
    const coords = this.view.coordsAtPos(this.pos);
    el.style.top = `${coords.bottom + 4}px`;
    el.style.left = `${coords.left}px`;

    // Add click handlers for reference items
    el.querySelectorAll("[data-file]").forEach(item => {
      item.addEventListener("click", (e) => {
        const target = e.currentTarget as HTMLElement;
        const filePath = target.dataset.file;
        const line = parseInt(target.dataset.line || "1", 10);
        if (filePath) {
          this.plugin.handleNavigate({ filePath, file: "", language: "", type: "", name: "", content: "", startLine: line, endLine: line, score: 0 } as NavigationResult);
        }
      });
    });

    // Handle keyboard
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const firstResult = this.view.state.field(codeNavState).results[0];
        if (firstResult) {
          this.plugin.handleNavigate(firstResult);
        }
        this.view.dispatch({ effects: hideNavTooltip.of(null) });
        e.preventDefault();
      }
    });

    // Close on click outside
    setTimeout(() => {
      document.addEventListener("click", (e) => {
        if (!el.contains(e.target as Node)) {
          this.view.dispatch({ effects: hideNavTooltip.of(null) });
        }
      }, { once: true });
    }, 0);

    return el;
  }

  ignoreEvent() {
    return false;
  }
}

// ============================================
// Export helper functions
// ============================================

export function createCursorExtensions(config: {
  projectId: string;
  projectRoot: string;
  language: string;
  filePath: string;
  tabAutocompleteEnabled?: boolean;
  onCmdKAccept?: (newCode: string) => void;
  onCmdKClose?: () => void;
  onNavigate?: (filePath: string, line: number, column?: number) => void;
}): Extension[] {
  const extensions: Extension[] = [];

  if (config.tabAutocompleteEnabled !== false) {
    extensions.push(createTabAutocompleteExtension({
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      language: config.language,
      filePath: config.filePath,
      enabled: config.tabAutocompleteEnabled !== false,
    }));
  }

  if (config.onCmdKAccept || config.onCmdKClose) {
    extensions.push(createCmdKEditExtension({
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      language: config.language,
      filePath: config.filePath,
      onAccept: config.onCmdKAccept || (() => {}),
      onClose: config.onCmdKClose || (() => {}),
    }));
  }

  // Always add code navigation if we have project config
  extensions.push(createCodeNavigationExtension({
    projectId: config.projectId,
    projectRoot: config.projectRoot,
    language: config.language,
    filePath: config.filePath,
    onNavigate: config.onNavigate,
  }));

  return extensions;
}

export { createTabAutocompleteExtension, createCmdKEditExtension };