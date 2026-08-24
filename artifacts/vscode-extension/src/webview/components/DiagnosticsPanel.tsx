import React, { useMemo } from 'react';

interface DiagnosticsPanelProps {
  diagnostics: any[];
  onOpenFile: (path: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: '#f44336',
  warning: '#ff9800',
  info: '#2196f3',
  hint: '#9e9e9e'
};

const SEVERITY_ICONS: Record<string, string> = {
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  hint: '💡'
};

export function DiagnosticsPanel({ diagnostics, onOpenFile }: DiagnosticsPanelProps) {
  const groupedByFile = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const d of diagnostics) {
      if (!groups[d.file]) groups[d.file] = [];
      groups[d.file].push(d);
    }
    return groups;
  }, [diagnostics]);

  const errorCount = diagnostics.filter(d => d.severity === 'error').length;
  const warningCount = diagnostics.filter(d => d.severity === 'warning').length;
  const infoCount = diagnostics.filter(d => d.severity === 'info').length;
  const hintCount = diagnostics.filter(d => d.severity === 'hint').length;

  if (diagnostics.length === 0) {
    return (
      <div className="diagnostics-empty">
        <span className="empty-icon">✓</span>
        <h3>No Diagnostics</h3>
        <p>All clean! Run a build or enable diagnostics to see issues here.</p>
      </div>
    );
  }

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-summary">
        <div className="summary-item error">
          <span className="summary-icon">{SEVERITY_ICONS.error}</span>
          <span className="summary-count">{errorCount}</span>
          <span className="summary-label">Errors</span>
        </div>
        <div className="summary-item warning">
          <span className="summary-icon">{SEVERITY_ICONS.warning}</span>
          <span className="summary-count">{warningCount}</span>
          <span className="summary-label">Warnings</span>
        </div>
        <div className="summary-item info">
          <span className="summary-icon">{SEVERITY_ICONS.info}</span>
          <span className="summary-count">{infoCount}</span>
          <span className="summary-label">Info</span>
        </div>
        <div className="summary-item hint">
          <span className="summary-icon">{SEVERITY_ICONS.hint}</span>
          <span className="summary-count">{hintCount}</span>
          <span className="summary-label">Hints</span>
        </div>
      </div>

      <div className="diagnostics-list">
        {Object.entries(groupedByFile).map(([file, fileDiagnostics]) => (
          <div key={file} className="diagnostic-file-group">
            <div className="file-header" onClick={() => onOpenFile(file)}>
              <span className="file-icon">📄</span>
              <span className="file-name">{file}</span>
              <span className="file-count">{fileDiagnostics.length} issues</span>
            </div>
            <div className="file-diagnostics">
              {fileDiagnostics.map((d, i) => (
                <div key={i} className={`diagnostic-item ${d.severity}`} style={{ borderLeftColor: SEVERITY_COLORS[d.severity] }}>
                  <div className="diagnostic-main" onClick={() => onOpenFile(file)}>
                    <span className="diagnostic-icon" style={{ color: SEVERITY_COLORS[d.severity] }}>
                      {SEVERITY_ICONS[d.severity]}
                    </span>
                    <span className="diagnostic-location">{file}:{d.line}:{d.column}</span>
                    <span className="diagnostic-message">{d.message}</span>
                  </div>
                  {d.code && (
                    <div className="diagnostic-code">Code: {d.code}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}