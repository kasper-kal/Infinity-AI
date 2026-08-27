/**
 * useAstHistory Hook
 *
 * Undo/redo stack for AST operations with keyboard shortcuts.
 * Integrates with the AST editor for code synchronization.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface AstOperation {
  id: string;
  type: 'insert' | 'delete' | 'replace' | 'wrap' | 'unwrap' | 'duplicate' | 'move' | 'updateProp' | 'updateProps' | 'addImport' | 'removeImport' | 'extractComponent' | 'updateClassName' | 'updateStyle' | 'transformJSX';
  selector: string;
  previousCode: string;
  newCode: string;
  timestamp: number;
  description: string;
}

interface UseAstHistoryOptions {
  maxHistorySize?: number;
  onCodeChange?: (code: string) => void;
  initialCode?: string;
}

interface UseAstHistoryReturn {
  /** Current code */
  code: string;
  /** Set code directly (adds to history) */
  setCode: (code: string, operation?: Partial<AstOperation>) => void;
  /** Apply an operation to the code */
  applyOperation: (operation: Omit<AstOperation, 'id' | 'timestamp' | 'previousCode'>) => void;
  /** Undo last operation */
  undo: () => void;
  /** Redo last undone operation */
  redo: () => void;
  /** Can undo */
  canUndo: boolean;
  /** Can redo */
  canRedo: boolean;
  /** History stack */
  history: AstOperation[];
  /** Redo stack */
  redoStack: AstOperation[];
  /** Clear history */
  clearHistory: () => void;
  /** Get history for debugging */
  getHistory: () => AstOperation[];
}

export function useAstHistory(options: UseAstHistoryOptions = {}): UseAstHistoryReturn {
  const { maxHistorySize = 50, onCodeChange, initialCode = '' } = options;

  const [code, setCodeState] = useState<string>(initialCode);
  const [history, setHistory] = useState<AstOperation[]>([]);
  const [redoStack, setRedoStack] = useState<AstOperation[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const isUndoingRef = useRef(false);
  const isRedoingRef = useRef(false);

  const canUndo = currentIndex >= 0;
  const canRedo = currentIndex < history.length - 1;

  // Notify parent of code changes
  useEffect(() => {
    if (!isUndoingRef.current && !isRedoingRef.current && onCodeChange) {
      onCodeChange(code);
    }
  }, [code, onCodeChange]);

  const setCode = useCallback((newCode: string, operation?: Partial<AstOperation>) => {
    if (newCode === code) return;

    const op: AstOperation = {
      id: crypto.randomUUID(),
      type: operation?.type || 'replace',
      selector: operation?.selector || '',
      previousCode: code,
      newCode,
      timestamp: Date.now(),
      description: operation?.description || 'Code changed',
      ...operation,
    } as AstOperation;

    // If we're in the middle of history, truncate future
    setHistory(prev => {
      const truncated = prev.slice(0, currentIndex + 1);
      const updated = [...truncated, op].slice(-maxHistorySize);
      return updated;
    });

    setCurrentIndex(prev => Math.min(prev + 1, maxHistorySize - 1));
    setRedoStack([]);
    setCodeState(newCode);
  }, [code, currentIndex, maxHistorySize]);

  const applyOperation = useCallback((operation: Omit<AstOperation, 'id' | 'timestamp' | 'previousCode'>) => {
    setCode(operation.newCode, operation);
  }, [setCode]);

  const undo = useCallback(() => {
    if (!canUndo) return;

    isUndoingRef.current = true;
    const previousOp = history[currentIndex];
    setCodeState(previousOp.previousCode);
    setCurrentIndex(prev => prev - 1);
    setRedoStack(prev => [previousOp, ...prev]);
    isUndoingRef.current = false;
  }, [canUndo, history, currentIndex]);

  const redo = useCallback(() => {
    if (!canRedo) return;

    isRedoingRef.current = true;
    const nextOp = history[currentIndex + 1];
    setCodeState(nextOp.newCode);
    setCurrentIndex(prev => prev + 1);
    setRedoStack(prev => prev.slice(1));
    isRedoingRef.current = false;
  }, [canRedo, history, currentIndex]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setRedoStack([]);
    setCurrentIndex(-1);
  }, []);

  const getHistory = useCallback(() => history, [history]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        // Duplicate - handled by components
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete - handled by components
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    code,
    setCode,
    applyOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    history,
    redoStack,
    clearHistory,
    getHistory,
  };
}

export default useAstHistory;