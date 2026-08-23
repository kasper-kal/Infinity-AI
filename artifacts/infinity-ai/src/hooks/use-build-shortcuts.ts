import { useEffect, useCallback, useRef } from 'react';

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  global?: boolean; // true = works anywhere, false = only when Build Studio is focused
}

/**
 * Phase 0 UI Unfuck — keyboard shortcuts for Build Studio.
 * Cmd/Ctrl+Enter: run build
 * Esc: cancel build / close dialogs
 * Cmd/Ctrl+.: toggle diff preview
 * Cmd/Ctrl+Shift+P: command palette
 */
export function useBuildShortcuts(shortcuts: Shortcut[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Still allow Escape to close dialogs
        if (event.key !== 'Escape') return;
      }

      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;
      const isAlt = event.altKey;

      for (const shortcut of shortcutsRef.current) {
        const keyMatch = shortcut.key.toLowerCase() === event.key.toLowerCase();
        const ctrlMatch = !shortcut.ctrl && !shortcut.meta || (shortcut.ctrl || shortcut.meta) && isCtrl;
        const shiftMatch = !shortcut.shift || shortcut.shift === isShift;
        const altMatch = !shortcut.alt || shortcut.alt === isAlt;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Format a shortcut for display (e.g., "���Enter", "Ctrl+Shift+P")
 */
export function formatShortcut(shortcut: Shortcut): string {
  const parts: string[] = [];
  if (typeof navigator !== 'undefined' && navigator.platform.includes('Mac')) {
    if (shortcut.meta || shortcut.ctrl) parts.push('���');
    if (shortcut.shift) parts.push('���');
    if (shortcut.alt) parts.push('���');
  } else {
    if (shortcut.ctrl || shortcut.meta) parts.push('Ctrl');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.alt) parts.push('Alt');
  }
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);
  return parts.join('+');
}

/**
 * Default Build Studio shortcuts — extend/override as needed.
 */
export function createDefaultShortcuts(actions: {
  runBuild?: () => void;
  cancelBuild?: () => void;
  toggleDiff?: () => void;
  openCommandPalette?: () => void;
  closeDialogs?: () => void;
}): Shortcut[] {
  const shortcuts: Shortcut[] = [];

  if (actions.runBuild) {
    shortcuts.push({
      key: 'Enter',
      ctrl: true,
      meta: true,
      action: actions.runBuild,
      description: 'Run build',
      global: true,
    });
  }

  if (actions.cancelBuild) {
    shortcuts.push({
      key: 'Escape',
      action: actions.cancelBuild,
      description: 'Cancel build / close dialogs',
      global: true,
    });
  }

  if (actions.toggleDiff) {
    shortcuts.push({
      key: '.',
      ctrl: true,
      meta: true,
      action: actions.toggleDiff,
      description: 'Toggle diff preview',
      global: true,
    });
  }

  if (actions.openCommandPalette) {
    shortcuts.push({
      key: 'P',
      ctrl: true,
      meta: true,
      shift: true,
      action: actions.openCommandPalette,
      description: 'Open command palette',
      global: true,
    });
  }

  if (actions.closeDialogs) {
    shortcuts.push({
      key: 'Escape',
      action: actions.closeDialogs,
      description: 'Close dialogs',
      global: true,
    });
  }

  return shortcuts;
}