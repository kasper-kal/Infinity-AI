import React, { useState, useEffect, useCallback } from 'react';

interface RulesNotepadsPanelProps {
  vscode: any;
  onSendMessage: (msg: any) => void;
  projectRoot: string;
  connected: boolean;
}

interface Rule {
  id: string;
  name: string;
  description: string;
  globs: string[];
  scope: 'user' | 'project' | 'team';
  enabled: boolean;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Notepad {
  id: string;
  name: string;
  category: string;
  content: string;
  scope: 'user' | 'project' | 'team';
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function RulesNotepadsPanel({ vscode, onSendMessage, projectRoot, connected }: RulesNotepadsPanelProps) {
  const [activeTab, setActiveTab] = useState<'rules' | 'notepads'>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [notepads, setNotepads] = useState<Notepad[]>([]);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [showCreateNotepad, setShowCreateNotepad] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [editingNotepad, setEditingNotepad] = useState<Notepad | null>(null);

  const handleMessage = useCallback((message: any) => {
    if (message.type === 'rules_list') {
      setRules(message.rules);
    } else if (message.type === 'notepads_list') {
      setNotepads(message.notepads);
    } else if (message.type === 'rule_created' || message.type === 'rule_updated') {
      setRules(prev => {
        const existing = prev.findIndex(r => r.id === message.rule.id);
        if (existing >= 0) {
          return [...prev.slice(0, existing), message.rule, ...prev.slice(existing + 1)];
        }
        return [...prev, message.rule];
      });
      setEditingRule(null);
      setShowCreateRule(false);
    } else if (message.type === 'notepad_created' || message.type === 'notepad_updated') {
      setNotepads(prev => {
        const existing = prev.findIndex(n => n.id === message.notepad.id);
        if (existing >= 0) {
          return [...prev.slice(0, existing), message.notepad, ...prev.slice(existing + 1)];
        }
        return [...prev, message.notepad];
      });
      setEditingNotepad(null);
      setShowCreateNotepad(false);
    } else if (message.type === 'rule_deleted') {
      setRules(prev => prev.filter(r => r.id !== message.ruleId));
    } else if (message.type === 'notepad_deleted') {
      setNotepads(prev => prev.filter(n => n.id !== message.notepadId));
    }
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => handleMessage(event.data);
    window.addEventListener('message', handler);
    if (connected) {
      onSendMessage({ type: 'rules_list' });
      onSendMessage({ type: 'notepads_list' });
    }
    return () => window.removeEventListener('message', handler);
  }, [handleMessage, connected, onSendMessage]);

  const handleCreateRule = useCallback(() => {
    setEditingRule({
      id: '',
      name: '',
      description: '',
      globs: [],
      scope: 'project',
      enabled: true,
      content: '',
      createdAt: '',
      updatedAt: '',
    });
    setShowCreateRule(true);
  }, []);

  const handleCreateNotepad = useCallback(() => {
    setEditingNotepad({
      id: '',
      name: '',
      category: 'general',
      content: '',
      scope: 'project',
      pinned: false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    });
    setShowCreateNotepad(true);
  }, []);

  const handleSaveRule = useCallback((rule: Rule) => {
    if (rule.id) {
      onSendMessage({ type: 'rule_update', rule });
    } else {
      onSendMessage({ type: 'rule_create', rule });
    }
  }, [onSendMessage]);

  const handleSaveNotepad = useCallback((notepad: Notepad) => {
    if (notepad.id) {
      onSendMessage({ type: 'notepad_update', notepad });
    } else {
      onSendMessage({ type: 'notepad_create', notepad });
    }
  }, [onSendMessage]);

  const handleDeleteRule = useCallback((id: string) => {
    if (confirm('Delete this rule?')) {
      onSendMessage({ type: 'rule_delete', ruleId: id });
    }
  }, [onSendMessage]);

  const handleDeleteNotepad = useCallback((id: string) => {
    if (confirm('Delete this notepad?')) {
      onSendMessage({ type: 'notepad_delete', notepadId: id });
    }
  }, [onSendMessage]);

  const handleToggleRule = useCallback((rule: Rule) => {
    onSendMessage({ type: 'rule_update', rule: { ...rule, enabled: !rule.enabled } });
  }, [onSendMessage]);

  const handleInsertNotepad = useCallback((notepad: Notepad) => {
    vscode.postMessage({
      type: 'send_to_infinity',
      message: `@notepad:${notepad.name}`,
    });
  }, [vscode]);

  return (
    <div className="rules-notepads-panel">
      <div className="panel-header">
        <h3>Rules & Notepads</h3>
        <div className="tab-selector">
          <button className={activeTab === 'rules' ? 'active' : ''} onClick={() => setActiveTab('rules')}>
            📋 Rules
          </button>
          <button className={activeTab === 'notepads' ? 'active' : ''} onClick={() => setActiveTab('notepads')}>
            📓 Notepads
          </button>
        </div>
      </div>

      {activeTab === 'rules' && (
        <div className="rules-content">
          <div className="rules-toolbar">
            <button className="btn primary" onClick={handleCreateRule} disabled={!connected}>
              + Create Rule
            </button>
            <div className="rules-filter">
              <select
                defaultValue="all"
                onChange={(e) => onSendMessage({ type: 'rules_filter', scope: e.target.value })}
              >
                <option value="all">All Scopes</option>
                <option value="user">User</option>
                <option value="project">Project</option>
                <option value="team">Team</option>
              </select>
            </div>
          </div>

          {showCreateRule || editingRule ? (
            <RuleEditor
              rule={editingRule}
              onSave={handleSaveRule}
              onCancel={() => { setEditingRule(null); setShowCreateRule(false); }}
              isNew={!!showCreateRule}
            />
          ) : (
            <RulesList
              rules={rules}
              onEdit={setEditingRule}
              onDelete={handleDeleteRule}
              onToggle={handleToggleRule}
              connected={connected}
            />
          )}
        </div>
      )}

      {activeTab === 'notepads' && (
        <div className="notepads-content">
          <div className="notepads-toolbar">
            <button className="btn primary" onClick={handleCreateNotepad} disabled={!connected}>
              + Create Notepad
            </button>
            <div className="notepads-filter">
              <select
                defaultValue="all"
                onChange={(e) => onSendMessage({ type: 'notepads_filter', category: e.target.value })}
              >
                <option value="all">All Categories</option>
                <option value="general">General</option>
                <option value="coding">Coding</option>
                <option value="architecture">Architecture</option>
                <option value="debugging">Debugging</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          {showCreateNotepad || editingNotepad ? (
            <NotepadEditor
              notepad={editingNotepad}
              onSave={handleSaveNotepad}
              onCancel={() => { setEditingNotepad(null); setShowCreateNotepad(false); }}
              isNew={!!showCreateNotepad}
            />
          ) : (
            <NotepadsList
              notepads={notepads}
              onEdit={setEditingNotepad}
              onDelete={handleDeleteNotepad}
              onInsert={handleInsertNotepad}
              connected={connected}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RuleEditor({ rule, onSave, onCancel, isNew }: {
  rule: Rule | null;
  onSave: (rule: Rule) => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<Rule>({
    id: '',
    name: '',
    description: '',
    globs: [],
    scope: 'project',
    enabled: true,
    content: '',
    createdAt: '',
    updatedAt: '',
  });

  useEffect(() => {
    if (rule) setForm(rule);
  }, [rule]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) return;
    onSave({ ...form, globs: form.globs.filter(g => g.trim()) });
  };

  const handleGlobsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const globs = e.target.value.split('\n').map(g => g.trim()).filter(g => g);
    setForm(prev => ({ ...prev, globs }));
  };

  return (
    <div className="rule-editor">
      <h4>{isNew ? 'Create Rule' : 'Edit Rule'}</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g., react-component-patterns"
          />
        </div>
        <div className="form-field">
          <label>Description</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
            placeholder="What does this rule do?"
          />
        </div>
        <div className="form-field">
          <label>Scope</label>
          <select
            value={form.scope}
            onChange={(e) => setForm(prev => ({ ...prev, scope: e.target.value as 'user' | 'project' | 'team' }))}
          >
            <option value="user">User (Global)</option>
            <option value="project">Project</option>
            <option value="team">Team</option>
          </select>
        </div>
        <div className="form-field">
          <label>Globs (one per line)</label>
          <textarea
            value={form.globs.join('\n')}
            onChange={handleGlobsChange}
            placeholder="*.tsx\n*.jsx\nsrc/components/**"
            rows={3}
          />
        </div>
        <div className="form-field">
          <label>Rule Content (Markdown)</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm(prev => ({ ...prev, content: e.target.value }))}
            placeholder="Write your rule instructions here..."
            rows={10}
            className="markdown-editor"
          />
        </div>
        <div className="form-field checkbox">
          <label>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
            />
            Enabled
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!connected}>{isNew ? 'Create' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function RulesList({ rules, onEdit, onDelete, onToggle, connected }: {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  onDelete: (id: string) => void;
  onToggle: (rule: Rule) => void;
  connected: boolean;
}) {
  if (rules.length === 0) {
    return (
      <div className="empty-state">
        <p>No rules configured. Click "Create Rule" to add one.</p>
      </div>
    );
  }

  return (
    <div className="rules-list">
      {rules.map(rule => (
        <div key={rule.id} className={`rule-item ${rule.enabled ? '' : 'disabled'}`}>
          <div className="rule-header">
            <div className="rule-info">
              <h4>{rule.name}</h4>
              <p>{rule.description}</p>
              <div className="rule-meta">
                <span className={`scope-badge ${rule.scope}`}>{rule.scope}</span>
                <span>{rule.globs.length} glob(s)</span>
                <span>{new Date(rule.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="rule-actions">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => onToggle(rule)}
                  disabled={!connected}
                />
                <span className="toggle-slider"></span>
              </label>
              <button className="icon-btn" onClick={() => onEdit(rule)} title="Edit" disabled={!connected}>✎</button>
              <button className="icon-btn danger" onClick={() => onDelete(rule.id)} title="Delete" disabled={!connected}>🗑</button>
            </div>
          </div>
          <details className="rule-content">
            <summary>View Content</summary>
            <pre className="rule-content-text">{rule.content}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}

function NotepadEditor({ notepad, onSave, onCancel, isNew }: {
  notepad: Notepad | null;
  onSave: (notepad: Notepad) => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<Notepad>({
    id: '',
    name: '',
    category: 'general',
    content: '',
    scope: 'project',
    pinned: false,
    tags: [],
    createdAt: '',
    updatedAt: '',
  });

  useEffect(() => {
    if (notepad) setForm(notepad);
  }, [notepad]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) return;
    onSave({ ...form, tags: form.tags.filter(t => t.trim()) });
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const tags = e.target.value.split(',').map(t => t.trim()).filter(t => t);
    setForm(prev => ({ ...prev, tags }));
  };

  return (
    <div className="notepad-editor">
      <h4>{isNew ? 'Create Notepad' : 'Edit Notepad'}</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g., api-patterns"
          />
        </div>
        <div className="form-field">
          <label>Category</label>
          <select
            value={form.category}
            onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}
          >
            <option value="general">General</option>
            <option value="coding">Coding Patterns</option>
            <option value="architecture">Architecture</option>
            <option value="debugging">Debugging</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="form-field">
          <label>Scope</label>
          <select
            value={form.scope}
            onChange={(e) => setForm(prev => ({ ...prev, scope: e.target.value as 'user' | 'project' | 'team' }))}
          >
            <option value="user">User (Global)</option>
            <option value="project">Project</option>
            <option value="team">Team</option>
          </select>
        </div>
        <div className="form-field">
          <label>Tags (comma-separated)</label>
          <input
            type="text"
            value={form.tags.join(', ')}
            onChange={handleTagsChange}
            placeholder="react, hooks, patterns"
          />
        </div>
        <div className="form-field checkbox">
          <label>
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm(prev => ({ ...prev, pinned: e.target.checked }))}
            />
            Pinned (show at top)
          </label>
        </div>
        <div className="form-field">
          <label>Content</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm(prev => ({ ...prev, content: e.target.value }))}
            placeholder="Write your notepad content here... Use @notepad:name to reference in chat."
            rows={12}
            className="markdown-editor"
          />
        </div>
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!connected}>{isNew ? 'Create' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function NotepadsList({ notepads, onEdit, onDelete, onInsert, connected }: {
  notepads: Notepad[];
  onEdit: (notepad: Notepad) => void;
  onDelete: (id: string) => void;
  onInsert: (notepad: Notepad) => void;
  connected: boolean;
}) {
  if (notepads.length === 0) {
    return (
      <div className="empty-state">
        <p>No notepads created. Click "Create Notepad" to add one.</p>
      </div>
    );
  }

  // Sort: pinned first, then by updatedAt desc
  const sorted = [...notepads].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <div className="notepads-list">
      {sorted.map(notepad => (
        <div key={notepad.id} className={`notepad-item ${notepad.pinned ? 'pinned' : ''}`}>
          <div className="notepad-header">
            <div className="notepad-info">
              {notepad.pinned && <span className="pin-badge">📌</span>}
              <h4>{notepad.name}</h4>
              <div className="notepad-meta">
                <span className={`category-badge ${notepad.category}`}>{notepad.category}</span>
                <span className={`scope-badge ${notepad.scope}`}>{notepad.scope}</span>
                {notepad.tags.length > 0 && (
                  <span className="tags">
                    {notepad.tags.map(t => <span key={t} className="tag">#{t}</span>)}
                  </span>
                )}
                <span>{new Date(notepad.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="notepad-actions">
              <button className="btn secondary" onClick={() => onInsert(notepad)} disabled={!connected}>
                Insert @notepad
              </button>
              <button className="icon-btn" onClick={() => onEdit(notepad)} title="Edit" disabled={!connected}>✎</button>
              <button className="icon-btn danger" onClick={() => onDelete(notepad.id)} title="Delete" disabled={!connected}>🗑</button>
            </div>
          </div>
          <details className="notepad-preview">
            <summary>Preview</summary>
            <div className="notepad-content">{notepad.content}</div>
          </details>
        </div>
      ))}
    </div>
  );
}