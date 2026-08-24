import React, { useMemo } from 'react';

interface BuildEventsProps {
  events: any[];
  onOpenFile: (path: string) => void;
  vscode: any;
}

const EVENT_ICONS: Record<string, string> = {
  build_start: '▶',
  build_step: '⚙',
  build_complete: '✓',
  build_error: '✗',
  terminal_output: '⌨',
  file_change: '📄',
  diagnostic: '⚠'
};

const EVENT_COLORS: Record<string, string> = {
  build_start: '#4caf50',
  build_step: '#2196f3',
  build_complete: '#4caf50',
  build_error: '#f44336',
  terminal_output: '#9e9e9e',
  file_change: '#ff9800',
  diagnostic: '#ff5722'
};

export function BuildEvents({ events, onOpenFile, vscode }: BuildEventsProps) {
  const groupedEvents = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const event of events) {
      const date = new Date(event.timestamp).toLocaleDateString();
      if (!groups[date]) groups[date] = [];
      groups[date].push(event);
    }
    return groups;
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="build-events-empty">
        <span className="empty-icon">📋</span>
        <p>No build events yet. Start a build to see activity here.</p>
      </div>
    );
  }

  return (
    <div className="build-events">
      <h3>Build Activity</h3>
      <div className="events-filter">
        <select className="filter-select" defaultValue="all">
          <option value="all">All Events</option>
          <option value="build_start">Build Start</option>
          <option value="build_step">Build Steps</option>
          <option value="build_complete">Completed</option>
          <option value="build_error">Errors</option>
          <option value="file_change">File Changes</option>
          <option value="diagnostic">Diagnostics</option>
        </select>
        <button className="btn-secondary small" onClick={() => vscode.postMessage({ type: 'clear_events' })}>
          Clear
        </button>
      </div>
      <div className="events-list">
        {Object.entries(groupedEvents).map(([date, dayEvents]) => (
          <div key={date} className="events-day-group">
            <div className="day-header">{date} ({dayEvents.length})</div>
            {dayEvents.slice().reverse().map((event) => (
              <div key={event.id} className="event-item" style={{ borderLeftColor: EVENT_COLORS[event.type] || '#666' }}>
                <div className="event-header">
                  <span className="event-icon" style={{ color: EVENT_COLORS[event.type] || '#666' }}>
                    {EVENT_ICONS[event.type] || '•'}
                  </span>
                  <span className="event-type">{event.type.replace(/_/g, ' ')}</span>
                  <span className="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="event-data">
                  {renderEventData(event, onOpenFile)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderEventData(event: any, onOpenFile: (path: string) => void) {
  const data = event.data;

  switch (event.type) {
    case 'build_start':
      return (
        <div className="event-build-start">
          <strong>Goal:</strong> {data.goal}
        </div>
      );

    case 'build_step':
      return (
        <div className="event-build-step">
          <strong>Step {data.stepNumber}/{data.totalSteps}:</strong> {data.description}
          {data.files && data.files.length > 0 && (
            <div className="event-files">
              {data.files.map((f: string) => (
                <span key={f} className="file-tag" onClick={() => onOpenFile(f)}>{f}</span>
              ))}
            </div>
          )}
        </div>
      );

    case 'build_complete':
      return (
        <div className="event-build-complete">
          <strong>Build completed in {data.duration}ms</strong>
          {data.summary && <p>{data.summary}</p>}
          {data.files && data.files.length > 0 && (
            <div className="event-files">
              {data.files.map((f: string) => (
                <span key={f} className="file-tag" onClick={() => onOpenFile(f)}>{f}</span>
              ))}
            </div>
          )}
        </div>
      );

    case 'build_error':
      return (
        <div className="event-build-error">
          <strong>Error:</strong> {data.error}
          {data.stack && <pre className="error-stack">{data.stack}</pre>}
        </div>
      );

    case 'file_change':
      return (
        <div className="event-file-change">
          <span className={`change-type ${data.type}`}>{data.type}</span>
          <span className="file-path" onClick={() => onOpenFile(data.path)}>{data.path}</span>
        </div>
      );

    case 'diagnostic':
      return (
        <div className="event-diagnostic">
          <span className={`diagnostic-severity ${data.severity}`}>{data.severity}</span>
          <span className="diagnostic-file" onClick={() => onOpenFile(data.file)}>{data.file}:{data.line}</span>
          <span className="diagnostic-message">{data.message}</span>
        </div>
      );

    default:
      return (
        <pre className="event-json">{JSON.stringify(data, null, 2)}</pre>
      );
  }
}