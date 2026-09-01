import React, { useState, useRef, useEffect, useCallback } from 'react';

interface TabAutocompleteProps {
  vscode: any;
  onSendMessage: (msg: any) => void;
  projectRoot: string;
  connected: boolean;
}

interface CompletionSuggestion {
  id: string;
  text: string;
  detail?: string;
  type: 'function' | 'variable' | 'class' | 'snippet' | 'keyword' | 'property';
  score: number;
  source: 'local' | 'remote' | 'wasm';
}

export function TabAutocomplete({ vscode, onSendMessage, projectRoot, connected }: TabAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<CompletionSuggestion[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastTriggerPos, setLastTriggerPos] = useState<{ line: number; character: number } | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // This component would integrate with the editor via VS Code's API
  // For the webview, we provide a settings panel for tab autocomplete configuration

  const handleConfigChange = useCallback((key: string, value: any) => {
    onSendMessage({ type: 'tab_autocomplete_config', config: { [key]: value } });
  }, [onSendMessage]);

  return (
    <div className="tab-autocomplete-panel">
      <h3>Tab Autocomplete</h3>

      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            defaultChecked={true}
            onChange={(e) => handleConfigChange('enabled', e.target.checked)}
          />
          Enable Tab Autocomplete
        </label>
        <small>AI-powered code completions as you type</small>
      </div>

      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            defaultChecked={true}
            onChange={(e) => handleConfigChange('wasmFallback', e.target.checked)}
          />
          WASM Local Model Fallback
        </label>
        <small>Use local WebAssembly model when offline or for instant completions</small>
      </div>

      <div className="setting-group">
        <label>Completion Trigger Delay (ms)</label>
        <input
          type="number"
          min="0"
          max="500"
          defaultValue={50}
          onChange={(e) => handleConfigChange('triggerDelay', parseInt(e.target.value))}
        />
      </div>

      <div className="setting-group">
        <label>Max Suggestions</label>
        <input
          type="number"
          min="1"
          max="20"
          defaultValue={10}
          onChange={(e) => handleConfigChange('maxSuggestions', parseInt(e.target.value))}
        />
      </div>

      <div className="setting-group">
        <label>Minimum Confidence Score</label>
        <input
          type="range"
          min="0"
          max="100"
          defaultValue={30}
          onChange={(e) => handleConfigChange('minConfidence', parseInt(e.target.value) / 100)}
        />
        <span>{30}%</span>
      </div>

      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            defaultChecked={true}
            onChange={(e) => handleConfigChange('includeSnippets', e.target.checked)}
          />
          Include Code Snippets
        </label>
      </div>

      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            defaultChecked={false}
            onChange={(e) => handleConfigChange('includeComments', e.target.checked)}
          />
          Include Comment Suggestions
        </label>
      </div>

      <div className="setting-group">
        <h4>Supported Languages</h4>
        <div className="language-checkboxes">
          {[
            'typescript', 'javascript', 'python', 'rust', 'go', 'java',
            'cpp', 'csharp', 'php', 'ruby', 'swift', 'kotlin',
            'html', 'css', 'scss', 'json', 'yaml', 'markdown',
            'sql', 'graphql', 'dockerfile', 'bash'
          ].map(lang => (
            <label key={lang} className="checkbox-inline">
              <input
                type="checkbox"
                defaultChecked={true}
                onChange={(e) => handleConfigChange(`lang_${lang}`, e.target.checked)}
              />
              {lang}
            </label>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <h4>Advanced</h4>
        <div className="setting-row">
          <label>Model</label>
          <select
            defaultValue="auto"
            onChange={(e) => handleConfigChange('model', e.target.value)}
          >
            <option value="auto">Auto (Best Available)</option>
            <option value="claude-3.5-sonnet">Claude 3.5 Sonnet</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="local-wasm">Local WASM Model</option>
          </select>
        </div>
        <div className="setting-row">
          <label>Context Lines</label>
          <input
            type="number"
            min="10"
            max="200"
            defaultValue={50}
            onChange={(e) => handleConfigChange('contextLines', parseInt(e.target.value))}
          />
        </div>
        <div className="setting-row">
          <label>Cache TTL (seconds)</label>
          <input
            type="number"
            min="60"
            max="3600"
            defaultValue={300}
            onChange={(e) => handleConfigChange('cacheTtl', parseInt(e.target.value))}
          />
        </div>
      </div>

      <div className="setting-actions">
        <button className="btn secondary" onClick={() => onSendMessage({ type: 'tab_autocomplete_clear_cache' })}>
          Clear Cache
        </button>
        <button className="btn secondary" onClick={() => onSendMessage({ type: 'tab_autocomplete_preload_model' })}>
          Preload WASM Model
        </button>
      </div>
    </div>
  );
}