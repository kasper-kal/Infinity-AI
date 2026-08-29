/**
 * Template Library UI
 *
 * Phase 22: Component Marketplace & Template Library
 *
 * Full project starters with customization wizard
 */

import React, { useState, useEffect, useCallback } from 'react';

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
    validation?: string; // validation rule description
  }>;
  files?: Array<{ path: string; size: number }>;
  designSystem?: Record<string, any>;
  deployConfig?: {
    platform: string;
    buildCommand: string;
    outputDir: string;
  };
}

interface WizardStep {
  id: string;
  title: string;
  description: string;
  component: React.ReactNode;
}

const CATEGORIES = ['fullstack', 'dashboard', 'landing', 'blog', 'docs', 'mobile', 'extension'];
const FRAMEWORKS = ['nextjs', 'vite-react', 'remix', 'astro', 'sveltekit', 'vue-nuxt', 'solidstart', 'any'];

export const TemplateLibrary: React.FC = () => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    query: '',
    category: '',
    framework: '',
  });
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState<Record<string, string>>({});
  const [installTarget, setInstallTarget] = useState('');
  const [installProgress, setInstallProgress] = useState<{
    step: string;
    message: string;
    progress: number;
    error?: string;
  } | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.query) params.set('q', filters.query);
      if (filters.category) params.set('category', filters.category);
      if (filters.framework) params.set('framework', filters.framework);
      params.set('limit', '50');

      const response = await fetch(`/api/marketplace/templates?${params.toString()}`);
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Wizard Steps
  const steps: WizardStep[] = [
    {
      id: 'configure',
      title: 'Configure',
      description: 'Customize your template with project settings',
      component: null, // Rendered inline
    },
    {
      id: 'preview',
      title: 'Preview',
      description: 'Review the file structure and design system',
      component: null,
    },
    {
      id: 'install',
      title: 'Install',
      description: 'Generate project files and install dependencies',
      component: null,
    },
  ];

  const handleVariableChange = (key: string, value: string) => {
    setWizardData(prev => ({ ...prev, [key]: value }));
  };

  const validateStep = (stepIndex: number): boolean => {
    if (stepIndex === 0 && selectedTemplate) {
      // Validate required variables
      for (const variable of selectedTemplate.variables) {
        if (variable.required && (!wizardData[variable.key] || wizardData[variable.key].trim() === '')) {
          return false;
        }
        if (variable.type === 'color' && wizardData[variable.key] && !/^#[0-9a-fA-F]{6}$/.test(wizardData[variable.key])) {
          return false;
        }
        if (variable.type === 'number' && wizardData[variable.key] && isNaN(Number(wizardData[variable.key]))) {
          return false;
        }
      }
    }
    return true;
  };

  const startWizard = (template: TemplateItem) => {
    setSelectedTemplate(template);
    setWizardOpen(true);
    setWizardStep(0);
    // Initialize with defaults
    const defaults: Record<string, string> = {};
    for (const v of template.variables) {
      if (v.default !== undefined) defaults[v.key] = v.default;
    }
    setWizardData(defaults);
    setInstallTarget(process.cwd() || '/path/to/project');
    setInstallProgress(null);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setSelectedTemplate(null);
    setWizardStep(0);
    setWizardData({});
    setInstallProgress(null);
  };

  const nextStep = () => {
    if (validateStep(wizardStep)) {
      setWizardStep(prev => Math.min(prev + 1, steps.length - 1));
    }
  };

  const prevStep = () => {
    setWizardStep(prev => Math.max(prev - 1, 0));
  };

  const handleInstall = async () => {
    if (!selectedTemplate || !installTarget) return;

    setInstallProgress({ step: 'customize', message: 'Customizing template...', progress: 10 });

    try {
      // Step 1: Customize template
      setInstallProgress({ step: 'customize', message: 'Writing template files...', progress: 30 });
      const res = await fetch('/api/marketplace/templates/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: selectedTemplate.name,
          variables: wizardData,
          targetDir: installTarget,
          version: selectedTemplate.version,
          installComponents: true,
        }),
      });

      const result = await res.json();

      if (result.success) {
        setInstallProgress({ step: 'complete', message: 'Template installed successfully!', progress: 100 });
        // Show post-install commands
        if (result.postInstallCommands && result.postInstallCommands.length > 0) {
          setTimeout(() => {
            alert(`Installation complete!\n\nNext steps:\n${result.postInstallCommands.join('\n')}`);
            closeWizard();
          }, 1500);
        } else {
          setTimeout(closeWizard, 1500);
        }
      } else {
        setInstallProgress({
          step: 'error',
          message: `Error: ${result.details?.join(', ') || 'Unknown error'}`,
          progress: 0,
          error: result.details?.join(', '),
        });
      }
    } catch (error) {
      setInstallProgress({
        step: 'error',
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // Render variable input
  const renderVariableInput = (variable: TemplateItem['variables'][0]) => {
    const value = wizardData[variable.key] || variable.default || '';
    const error = variable.required && wizardStep === 0 && !value;

    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      handleVariableChange(variable.key, e.target.value);
    };

    return (
      <div className="variable-field">
        <label htmlFor={variable.key}>
          {variable.label}
          {variable.required && <span className="required">*</span>}
          {variable.validation && <span className="validation-hint">({variable.validation})</span>}
        </label>
        <div className="input-wrapper">
          {variable.type === 'color' && (
            <>
              <input
                type="color"
                id={variable.key}
                value={value || '#6366f1'}
                onChange={onChange}
                className="color-picker"
              />
              <input
                type="text"
                value={value || '#6366f1'}
                onChange={onChange}
                className="color-hex"
                placeholder="#6366f1"
              />
            </>
          )}
          {variable.type === 'select' && (
            <select id={variable.key} value={value} onChange={onChange} className={error ? 'error' : ''}>
              <option value="">Select...</option>
              {variable.options?.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {variable.type === 'boolean' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                id={variable.key}
                checked={value === 'true'}
                onChange={e => onChange(e as any)}
              />
              <span>{variable.label}</span>
            </label>
          )}
          {variable.type === 'number' && (
            <input
              type="number"
              id={variable.key}
              value={value}
              onChange={onChange}
              className={error ? 'error' : ''}
              placeholder={variable.default}
            />
          )}
          {variable.type === 'text' && (
            <input
              type="text"
              id={variable.key}
              value={value}
              onChange={onChange}
              className={error ? 'error' : ''}
              placeholder={variable.default}
            />
          )}
        </div>
        {error && <span className="field-error">This field is required</span>}
      </div>
    );
  };

  const renderTemplateCard = (template: TemplateItem) => (
    <div
      className="template-card"
      onClick={() => startWizard(template)}
    >
      <div className="card-image">
        {template.preview ? (
          <img src={template.preview} alt={template.title} />
        ) : (
          <div className="placeholder">📦</div>
        )}
        <span className="category-badge">{template.category}</span>
      </div>
      <div className="card-content">
        <div className="card-header">
          <h3>{template.title}</h3>
          <span className="version">v{template.version}</span>
        </div>
        <p className="description">{template.description}</p>
        <div className="card-meta">
          <span className="badge framework">{template.framework}</span>
          {template.tags.slice(0, 3).map(tag => (
            <span key={tag} className="badge tag">#{tag}</span>
          ))}
        </div>
        <div className="card-stats">
          <span>⭐ {template.rating} ({template.ratingCount})</span>
          <span>📥 {template.downloads.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="template-library">
      <style jsx>{`
        .template-library {
          padding: 24px;
          max-width: 1400px;
          margin: 0 auto;
        }
        .header {
          margin-bottom: 24px;
        }
        .header h1 { margin: 0 0 8px; font-size: 28px; color: #1e293b; }
        .header p { margin: 0; color: #64748b; font-size: 16px; }
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
          font-size: 12px; font-weight: 500; color: #64748b;
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .filter-group select, .filter-group input {
          padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 14px;
          background: white; min-width: 180px;
        }
        .filter-group input { min-width: 280px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 24px;
        }
        .template-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
          transition: all 0.2s;
          cursor: pointer;
        }
        .template-card:hover {
          border-color: #6366f1;
          box-shadow: 0 12px 32px rgba(99, 102, 241, 0.12);
          transform: translateY(-4px);
        }
        .card-image {
          position: relative;
          height: 160px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card-image img { width: 100%; height: 100%; object-fit: cover; }
        .placeholder { font-size: 48px; opacity: 0.3; }
        .category-badge {
          position: absolute;
          top: 12px; left: 12px;
          background: rgba(255,255,255,0.9);
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          color: #374151;
        }
        .card-content { padding: 20px; }
        .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .card-header h3 { margin: 0; font-size: 17px; font-weight: 600; color: #1e293b; }
        .version { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; }
        .description { margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.5;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .card-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .badge { font-size: 11px; font-weight: 500; padding: 3px 8px; border-radius: 4px; }
        .badge.framework { background: #fef3c7; color: #92400e; }
        .badge.tag { background: #fce7f3; color: #9d174d; }
        .card-stats { display: flex; justify-content: space-between; font-size: 12px; color: #64748b;
          padding-top: 12px; border-top: 1px solid #f1f5f9; }
        .loading { display: flex; justify-content: center; align-items: center; height: 200px; color: #64748b; }
        .empty { text-align: center; padding: 60px 20px; color: #64748b; }

        /* Wizard Modal */
        .wizard-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
          padding: 20px;
        }
        .wizard {
          background: white; border-radius: 16px; width: 100%; max-width: 720px;
          max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.2);
        }
        .wizard-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 20px 24px; border-bottom: 1px solid #e2e8f0;
        }
        .wizard-header h2 { margin: 0; font-size: 20px; }
        .wizard-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #64748b; padding: 4px; }
        .wizard-progress {
          display: flex; padding: 0 24px; margin-top: -10px; margin-bottom: 16px;
        }
        .progress-step {
          flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
          position: relative;
        }
        .progress-step::before {
          content: ''; position: absolute; top: 12px; left: 50%; right: -50%;
          height: 2px; background: #e2e8f0; z-index: 0;
        }
        .progress-step:last-child::before { display: none; }
        .progress-step.active::before { background: #6366f1; }
        .progress-step.completed::before { background: #22c55e; }
        .step-circle {
          width: 24px; height: 24px; border-radius: 50%;
          background: #e2e8f0; color: #64748b;
          display: flex; align-items: center; justify-content: center;
          font-weight: 600; font-size: 12px; z-index: 1;
          transition: all 0.2s;
        }
        .progress-step.active .step-circle { background: #6366f1; color: white; box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.2); }
        .progress-step.completed .step-circle { background: #22c55e; color: white; }
        .step-label { font-size: 11px; color: #64748b; text-align: center; white-space: nowrap; }
        .progress-step.active .step-label { color: #6366f1; font-weight: 500; }
        .progress-step.completed .step-label { color: #22c55e; }
        .wizard-body { flex: 1; padding: 0 24px 24px; overflow: auto; }
        .wizard-step { animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .step-title { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 4px; }
        .step-description { color: #64748b; margin: 0 0 24px; }
        .form-section { margin-bottom: 24px; }
        .form-section h4 { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #374151; }
        .variable-field { margin-bottom: 20px; }
        .variable-field label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 500; color: #334155; }
        .required { color: #ef4444; }
        .validation-hint { font-size: 12px; color: #94a3b8; font-weight: 400; }
        .input-wrapper { display: flex; gap: 8px; align-items: center; }
        .input-wrapper input[type="text"], .input-wrapper input[type="number"], .input-wrapper select {
          flex: 1; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;
        }
        .input-wrapper input.error, .input-wrapper select.error { border-color: #ef4444; }
        .input-wrapper input:focus, .input-wrapper select:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); }
        .color-picker { width: 48px; height: 40px; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; }
        .color-hex { width: 100px !important; }
        .checkbox-label { display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 400; }
        .checkbox-label input { width: 18px; height: 18px; accent-color: #6366f1; }
        .field-error { font-size: 12px; color: #ef4444; margin-top: 4px; display: block; }
        .preview-section { background: #f8fafc; border-radius: 12px; padding: 20px; }
        .preview-section h4 { margin: 0 0 16px; font-size: 14px; font-weight: 600; }
        .preview-files { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
        .preview-file { font-size: 12px; padding: 8px 12px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; font-family: monospace; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .preview-design-system { margin-top: 16px; }
        .design-token { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .design-token:last-child { border-bottom: none; }
        .install-progress { margin-top: 20px; padding: 16px; border-radius: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; }
        .install-progress.error { background: #fef2f2; border-color: #fecaca; }
        .progress-bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-top: 12px; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 3px; transition: width 0.3s; }
        .install-progress.error .progress-fill { background: #ef4444; }
        .wizard-actions { display: flex; justify-content: space-between; padding: 20px 24px; border-top: 1px solid #e2e8f0; }
        .btn { padding: 12px 24px; border-radius: 8px; font-weight: 500; cursor: pointer; border: none; font-size: 14px; transition: all 0.2s; }
        .btn-primary { background: #6366f1; color: white; }
        .btn-primary:hover:not(:disabled) { background: #4f46e5; }
        .btn-secondary { background: #f1f5f9; color: #334155; }
        .btn-secondary:hover:not(:disabled) { background: #e2e8f0; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      <div className="header">
        <h1>Template Library</h1>
        <p>Production-ready project starters with AI-powered customization</p>
      </div>

      <div className="filters">
        <div className="filter-group">
          <label>Search</label>
          <input
            type="text"
            placeholder="Search templates..."
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
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
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
        <div className="loading">Loading templates...</div>
      ) : (
        <div className="grid">
          {templates.length === 0 ? (
            <div className="empty">
              <h3>No templates found</h3>
              <p>Try adjusting your filters or search terms.</p>
            </div>
          ) : (
            templates.map(template => renderTemplateCard(template))
          )}
        </div>
      )}

      {/* Wizard Modal */}
      {wizardOpen && selectedTemplate && (
        <div className="wizard-overlay" onClick={closeWizard}>
          <div className="wizard" onClick={e => e.stopPropagation()}>
            {/* Progress Indicator */}
            <div className="wizard-progress">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`progress-step ${index < wizardStep ? 'completed' : index === wizardStep ? 'active' : ''}`}
                >
                  <div className="step-circle">
                    {index < wizardStep ? '✓' : index + 1}
                  </div>
                  <span className="step-label">{step.title}</span>
                </div>
              ))}
            </div>

            {/* Header */}
            <div className="wizard-header">
              <h2>{selectedTemplate.title}</h2>
              <button className="wizard-close" onClick={closeWizard}>×</button>
            </div>

            {/* Body */}
            <div className="wizard-body">
              {wizardStep === 0 && (
                <div className="wizard-step">
                  <h3 className="step-title">Configure Your Project</h3>
                  <p className="step-description">{selectedTemplate.description}</p>

                  <div className="form-section">
                    <h4>Project Settings</h4>
                    <div className="variable-field">
                      <label htmlFor="targetDir">Target Directory <span className="required">*</span></label>
                      <input
                        type="text"
                        id="targetDir"
                        value={installTarget}
                        onChange={e => setInstallTarget(e.target.value)}
                        placeholder="/path/to/your/project"
                      />
                    </div>
                  </div>

                  {selectedTemplate.variables.length > 0 && (
                    <div className="form-section">
                      <h4>Template Options</h4>
                      {selectedTemplate.variables.map(variable => (
                        <div key={variable.key}>
                          {renderVariableInput(variable)}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedTemplate.variables.length === 0 && (
                    <div className="form-section">
                      <p style={{ color: '#64748b' }}>This template has no configurable options.</p>
                    </div>
                  )}
                </div>
              )}

              {wizardStep === 1 && (
                <div className="wizard-step">
                  <h3 className="step-title">Preview Installation</h3>
                  <p className="step-description">Review what will be generated</p>

                  <div className="preview-section">
                    <h4>Framework: {selectedTemplate.framework}</h4>
                    <p style={{ margin: '8px 0', color: '#64748b', fontSize: '13px' }}>
                      Deploy: {selectedTemplate.deployConfig?.platform || 'vercel'} · Build: {selectedTemplate.deployConfig?.buildCommand || 'npm run build'}
                    </p>

                    <h4>Files to Generate</h4>
                    <div className="preview-files">
                      {selectedTemplate.files?.slice(0, 20).map(f => (
                        <div key={f.path} className="preview-file">{f.path}</div>
                      ))}
                      {(selectedTemplate.files && selectedTemplate.files.length > 20) && (
                        <div className="preview-file">... and {selectedTemplate.files.length - 20} more files</div>
                      )}
                    </div>

                    {selectedTemplate.designSystem && Object.keys(selectedTemplate.designSystem).length > 0 && (
                      <div className="preview-design-system">
                        <h4>Design System Tokens</h4>
                        {Object.entries(selectedTemplate.designSystem).flatMap(([category, tokens]) =>
                          typeof tokens === 'object' && tokens !== null
                            ? Object.entries(tokens).map(([key, value]) => (
                                <div key={`${category}.${key}`} className="design-token">
                                  <span>{category}.{key}</span>
                                  <code>{JSON.stringify(value)}</code>
                                </div>
                              ))
                            : []
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="wizard-step">
                  <h3 className="step-title">Installing Template</h3>
                  <p className="step-description">Generating your project...</p>

                  {installProgress && (
                    <div className={`install-progress ${installProgress.error ? 'error' : ''}`}>
                      <div><strong>{installProgress.message}</strong></div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${installProgress.progress}%` }}></div>
                      </div>
                      {installProgress.error && (
                        <div style={{ marginTop: '12px', fontSize: '13px', color: '#991b1b' }}>
                          {installProgress.error}
                        </div>
                      )}
                    </div>
                  )}

                  {!installProgress && (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      <p>Ready to install <strong>{selectedTemplate.title}</strong> to:</p>
                      <code style={{ display: 'block', marginTop: '8px', padding: '8px', background: '#f1f5f9', borderRadius: '6px' }}>
                        {installTarget}
                      </code>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="wizard-actions">
              <button
                className="btn btn-secondary"
                onClick={prevStep}
                disabled={wizardStep === 0}
              >
                Back
              </button>
              <div style={{ display: 'flex', gap: '12px' }}>
                {wizardStep < steps.length - 1 ? (
                  <button
                    className="btn btn-primary"
                    onClick={nextStep}
                    disabled={!validateStep(wizardStep)}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleInstall}
                    disabled={installProgress?.progress === 100 || !!installProgress?.error}
                  >
                    {installProgress?.progress === 100 ? 'Done' : installProgress ? 'Installing...' : 'Install Template'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateLibrary;