/**
 * Component Marketplace UI
 *
 * Phase 22: Component Marketplace & Template Library
 *
 * Browse, search, preview, and install components
 */

import React, { useState, useEffect, useCallback } from 'react';

export interface ComponentItem {
  name: string;
  version: string;
  title: string;
  description: string;
  category: string;
  framework: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
  ratingCount: number;
  preview?: string;
}

export interface TemplateItem {
  name: string;
  version: string;
  title: string;
  description: string;
  category: string;
  framework: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
  ratingCount: number;
  preview?: string;
  variables: Array<{
    key: string;
    label: string;
    type: 'text' | 'color' | 'select' | 'boolean' | 'number';
    default?: string;
    options?: string[];
    required: boolean;
  }>;
}

interface MarketplaceFilters {
  query: string;
  category: string;
  framework: string;
  type: 'components' | 'templates';
}

const CATEGORIES = ['ui', 'layout', 'form', 'data-display', 'navigation', 'feedback', 'utility', 'fullstack', 'dashboard', 'landing', 'blog', 'docs', 'mobile', 'extension'];
const FRAMEWORKS = ['nextjs', 'vite-react', 'remix', 'astro', 'sveltekit', 'vue-nuxt', 'solidstart', 'any'];

export const ComponentMarketplace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'components' | 'templates'>('components');
  const [filters, setFilters] = useState<MarketplaceFilters>({
    query: '',
    category: '',
    framework: '',
    type: 'components',
  });
  const [components, setComponents] = useState<ComponentItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ComponentItem | TemplateItem | null>(null);
  const [installDialog, setInstallDialog] = useState<{ open: boolean; item?: ComponentItem | TemplateItem; isTemplate: boolean }>({ open: false });
  const [installTarget, setInstallTarget] = useState('');
  const [installProgress, setInstallProgress] = useState<string>('');
  const [variables, setVariables] = useState<Record<string, string>>({});

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const type = activeTab;
      const params = new URLSearchParams();
      if (filters.query) params.set('q', filters.query);
      if (filters.category) params.set('category', filters.category);
      if (filters.framework) params.set('framework', filters.framework);
      params.set('limit', '50');

      const response = await fetch(`/api/marketplace/${type}?${params.toString()}`);
      const data = await response.json();

      if (type === 'components') {
        setComponents(data.components || []);
      } else {
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('Failed to fetch marketplace data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setFilters(prev => ({ ...prev, type: activeTab }));
  }, [activeTab]);

  // Handle install
  const handleInstall = async () => {
    if (!installDialog.item || !installTarget) return;

    setInstallProgress('Starting installation...');
    const item = installDialog.item;
    const isTemplate = installDialog.isTemplate;

    try {
      if (isTemplate) {
        setInstallProgress('Customizing template...');
        const res = await fetch('/api/marketplace/templates/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateName: item.name,
            variables,
            targetDir: installTarget,
            version: item.version,
          }),
        });
        const result = await res.json();
        if (result.success) {
          setInstallProgress('Template installed successfully!');
          setTimeout(() => setInstallDialog({ open: false }), 2000);
        } else {
          setInstallProgress(`Error: ${result.details?.join(', ') || 'Unknown error'}`);
        }
      } else {
        setInstallProgress('Installing component...');
        const res = await fetch('/api/marketplace/components/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name,
            version: item.version,
            targetDir: installTarget,
          }),
        });
        const result = await res.json();
        if (result.errors.length === 0) {
          setInstallProgress('Component installed successfully!');
          setTimeout(() => setInstallDialog({ open: false }), 2000);
        } else {
          setInstallProgress(`Error: ${result.errors.join(', ')}`);
        }
      }
    } catch (error) {
      setInstallProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Open install dialog
  const openInstall = (item: ComponentItem | TemplateItem) => {
    setSelectedItem(item);
    setInstallDialog({ open: true, item, isTemplate: activeTab === 'templates' });
    setInstallTarget(process.cwd() || '/path/to/project');
    setInstallProgress('');
    if (activeTab === 'templates' && 'variables' in item) {
      const defaults: Record<string, string> = {};
      for (const v of item.variables) {
        if (v.default !== undefined) defaults[v.key] = v.default;
      }
      setVariables(defaults);
    }
  };

  // Render variable input
  const renderVariableInput = (variable: TemplateItem['variables'][0]) => {
    const value = variables[variable.key] || variable.default || '';
    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setVariables(prev => ({ ...prev, [variable.key]: e.target.value }));
    };

    switch (variable.type) {
      case 'color':
        return (
          <div className="variable-input">
            <label>{variable.label} {variable.required && <span className="required">*</span>}</label>
            <input type="color" value={value || '#6366f1'} onChange={onChange} />
            <input type="text" value={value || '#6366f1'} onChange={onChange} style={{ width: '80px', marginLeft: '8px' }} />
          </div>
        );
      case 'select':
        return (
          <div className="variable-input">
            <label>{variable.label} {variable.required && <span className="required">*</span>}</label>
            <select value={value} onChange={onChange}>
              {variable.options?.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        );
      case 'boolean':
        return (
          <div className="variable-input checkbox">
            <label>
              <input type="checkbox" checked={value === 'true'} onChange={e => onChange(e as any)} />
              {variable.label} {variable.required && <span className="required">*</span>}
            </label>
          </div>
        );
      case 'number':
        return (
          <div className="variable-input">
            <label>{variable.label} {variable.required && <span className="required">*</span>}</label>
            <input type="number" value={value} onChange={onChange} />
          </div>
        );
      default:
        return (
          <div className="variable-input">
            <label>{variable.label} {variable.required && <span className="required">*</span>}</label>
            <input type="text" value={value} onChange={onChange} placeholder={variable.default} />
          </div>
        );
    }
  };

  // Render item card
  const renderCard = (item: ComponentItem | TemplateItem) => (
    <div
      className="marketplace-card"
      onClick={() => openInstall(item)}
      style={{ cursor: 'pointer' }}
    >
      <div className="card-header">
        <h3>{item.title}</h3>
        <span className="version">v{item.version}</span>
      </div>
      <p className="description">{item.description}</p>
      <div className="card-meta">
        <span className="badge category">{item.category}</span>
        <span className="badge framework">{item.framework}</span>
        {item.tags.slice(0, 3).map(tag => (
          <span key={tag} className="badge tag">#{tag}</span>
        ))}
      </div>
      <div className="card-stats">
        <span>⭐ {item.rating} ({item.ratingCount})</span>
        <span>📥 {item.downloads.toLocaleString()}</span>
      </div>
    </div>
  );

  return (
    <div className="component-marketplace">
      <style jsx>{`
        .component-marketplace {
          padding: 24px;
          max-width: 1400px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          color: #1e293b;
        }
        .tabs {
          display: flex;
          gap: 8px;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 8px;
        }
        .tab {
          padding: 10px 20px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          color: #64748b;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .tab.active {
          background: #6366f1;
          color: white;
        }
        .tab:hover:not(.active) {
          background: #f1f5f9;
          color: #1e293b;
        }
        .filters {
          display: flex;
          gap: 16px;
          margin: 20px 0;
          flex-wrap: wrap;
          align-items: center;
        }
        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .filter-group label {
          font-size: 12px;
          font-weight: 500;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .filter-group select,
        .filter-group input {
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 14px;
          background: white;
          min-width: 180px;
        }
        .filter-group input {
          min-width: 280px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }
        .marketplace-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          transition: all 0.2s;
        }
        .marketplace-card:hover {
          border-color: #6366f1;
          box-shadow: 0 8px 24px rgba(99, 102, 241, 0.1);
          transform: translateY(-2px);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
        }
        .card-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #1e293b;
        }
        .version {
          font-size: 12px;
          color: #64748b;
          background: #f1f5f9;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .description {
          margin: 0 0 16px;
          color: #475569;
          font-size: 14px;
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .badge {
          font-size: 11px;
          font-weight: 500;
          padding: 3px 8px;
          border-radius: 4px;
        }
        .badge.category { background: #dbeafe; color: #1e40af; }
        .badge.framework { background: #fef3c7; color: #92400e; }
        .badge.tag { background: #fce7f3; color: #9d174d; }
        .card-stats {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #64748b;
          padding-top: 12px;
          border-top: 1px solid #f1f5f9;
        }
        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          color: #64748b;
        }
        .empty {
          text-align: center;
          padding: 60px 20px;
          color: #64748b;
        }
        /* Install Dialog */
        .dialog-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .dialog {
          background: white;
          border-radius: 16px;
          padding: 24px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          overflow: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
        }
        .dialog-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .dialog-header h2 { margin: 0; font-size: 20px; }
        .close-btn {
          background: none; border: none; font-size: 24px; cursor: pointer; color: #64748b;
        }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 500; color: #334155; }
        .form-group input, .form-group select {
          width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;
        }
        .form-group input:focus, .form-group select:focus {
          outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        .variables-section {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
        }
        .variables-section h3 { margin: 0 0 16px; font-size: 16px; }
        .variable-input { margin-bottom: 16px; }
        .variable-input label { display: block; margin-bottom: 6px; font-weight: 500; }
        .variable-input input[type="text"], .variable-input input[type="number"] {
          width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
        }
        .variable-input select { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; }
        .variable-input.checkbox label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .required { color: #ef4444; }
        .dialog-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid #e2e8f0;
        }
        .btn {
          padding: 10px 20px; border-radius: 8px; font-weight: 500; cursor: pointer; border: none;
          transition: all 0.2s;
        }
        .btn-primary { background: #6366f1; color: white; }
        .btn-primary:hover { background: #4f46e5; }
        .btn-secondary { background: #f1f5f9; color: #334155; }
        .btn-secondary:hover { background: #e2e8f0; }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .install-progress {
          margin-top: 16px; padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; color: #166534;
        }
        .install-progress.error { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
      `}</style>

      <div className="header">
        <h1>{activeTab === 'components' ? 'Component Marketplace' : 'Template Library'}</h1>
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'components' ? 'active' : ''}`}
            onClick={() => setActiveTab('components')}
          >
            Components
          </button>
          <button
            className={`tab ${activeTab === 'templates' ? 'active' : ''}`}
            onClick={() => setActiveTab('templates')}
          >
            Templates
          </button>
        </div>
      </div>

      <div className="filters">
        <div className="filter-group">
          <label>Search</label>
          <input
            type="text"
            placeholder="Search components..."
            value={filters.query}
            onChange={e => setFilters(prev => ({ ...prev, query: e.target.value }))}
          />
        </div>
        <div className="filter-group">
          <label>Category</label>
          <select
            value={filters.category}
            onChange={e => setFilters(prev => ({ ...prev, category: e.target.value }))}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Framework</label>
          <select
            value={filters.framework}
            onChange={e => setFilters(prev => ({ ...prev, framework: e.target.value }))}
          >
            <option value="">All Frameworks</option>
            {FRAMEWORKS.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : activeTab === 'components' ? (
        <div className="grid">
          {components.length === 0 ? (
            <div className="empty">No components found. Try adjusting your filters.</div>
          ) : (
            components.map(component => renderCard(component))
          )}
        </div>
      ) : (
        <div className="grid">
          {templates.length === 0 ? (
            <div className="empty">No templates found. Try adjusting your filters.</div>
          ) : (
            templates.map(template => renderCard(template))
          )}
        </div>
      )}

      {/* Install Dialog */}
      {installDialog.open && installDialog.item && (
        <div className="dialog-overlay" onClick={() => setInstallDialog({ open: false })}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Install {installDialog.isTemplate ? 'Template' : 'Component'}</h2>
              <button className="close-btn" onClick={() => setInstallDialog({ open: false })}>×</button>
            </div>

            <div className="form-group">
              <label>Target Directory</label>
              <input
                type="text"
                value={installTarget}
                onChange={e => setInstallTarget(e.target.value)}
                placeholder="/path/to/your/project"
              />
            </div>

            {installDialog.isTemplate && 'variables' in installDialog.item && (
              <div className="variables-section">
                <h3>Customize Template</h3>
                {installDialog.item.variables.map(variable => (
                  <div key={variable.key}>
                    {renderVariableInput(variable)}
                  </div>
                ))}
              </div>
            )}

            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setInstallDialog({ open: false })}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleInstall}
                disabled={!installTarget || installProgress.includes('Error') || installProgress.includes('successfully')}
              >
                {installProgress ? 'Installing...' : 'Install'}
              </button>
            </div>

            {installProgress && (
              <div className={`install-progress ${installProgress.includes('Error') ? 'error' : ''}`}>
                {installProgress}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ComponentMarketplace;