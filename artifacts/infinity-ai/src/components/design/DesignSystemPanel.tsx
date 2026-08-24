/**
 * DesignSystemPanel.tsx — Design System Manager
 *
 * Create once, everything snaps. Colors, typography, spacing, components defined once.
 * All canvas elements auto-snap to design system. Brand kit: "Your brand everywhere in one click".
 * Changes to design system propagate to all artifacts.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit2, Eye, EyeOff, Copy, Palette, Type, Ruler, Square, Box, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Hash } from 'lucide-react';

interface DesignToken {
  id: string;
  name: string;
  value: string;
  description?: string;
  category?: string;
}

interface TypographyToken {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
}

interface DesignComponent {
  id: string;
  name: string;
  layerId: string;
  props: any[];
  variants: any[];
}

interface DesignSystemPanelProps {
  designSystem: any; // DesignSystem from engine
  onUpdate: (changes: Partial<any>) => void;
  compact?: boolean;
}

export function DesignSystemPanel({ designSystem, onUpdate, compact = false }: DesignSystemPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'colors' | 'typography' | 'spacing' | 'components' | 'radius' | 'shadows'>('colors');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAdd, setShowAdd] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState('');

  const tabs = [
    { id: 'colors', icon: Palette, label: t('design.system.colors'), count: designSystem?.colors?.length || 0 },
    { id: 'typography', icon: Type, label: t('design.system.typography'), count: designSystem?.typography?.length || 0 },
    { id: 'spacing', icon: Ruler, label: t('design.system.spacing'), count: designSystem?.spacing?.length || 0 },
    { id: 'radius', icon: Square, label: t('design.system.radius'), count: designSystem?.borderRadius?.length || 0 },
    { id: 'shadows', icon: Square, label: t('design.system.shadows'), count: designSystem?.shadows?.length || 0 },
    { id: 'components', icon: Box, label: t('design.system.components'), count: designSystem?.components?.length || 0 },
  ];

  const tokens = useMemo(() => {
    switch (activeTab) {
      case 'colors': return designSystem?.colors || [];
      case 'typography': return designSystem?.typography || [];
      case 'spacing': return designSystem?.spacing || [];
      case 'radius': return designSystem?.borderRadius || [];
      case 'shadows': return designSystem?.shadows || [];
      case 'components': return designSystem?.components || [];
      default: return [];
    }
  }, [activeTab, designSystem]);

  const handleUpdateToken = (id: string, value: string) => {
    const updated = { ...designSystem };
    updated[activeTab] = updated[activeTab].map((t: any) =>
      t.id === id ? { ...t, value } : t
    );
    onUpdate(updated);
    setEditingId(null);
  };

  const handleDeleteToken = (id: string) => {
    const updated = { ...designSystem };
    updated[activeTab] = updated[activeTab].filter((t: any) => t.id !== id);
    onUpdate(updated);
  };

  const handleAddToken = () => {
    if (!newTokenName.trim()) return;

    const newToken = {
      id: `${activeTab}-${Date.now()}`,
      name: newTokenName,
      value: '',
      description: '',
    };

    const updated = { ...designSystem };
    updated[activeTab] = [...(updated[activeTab] || []), newToken];
    onUpdate(updated);

    setNewTokenName('');
    setShowAdd(null);
  };

  const handleCopyValue = (value: string) => {
    navigator.clipboard.writeText(value);
    // Could show toast
  };

  const renderTokenValue = (token: any) => {
    if (activeTab === 'colors') {
      return (
        <div className="token-value color-swatch" style={{ backgroundColor: token.value }} title={token.value} />
      );
    }
    if (activeTab === 'typography') {
      return (
        <span className="token-value typography-preview" style={{ fontFamily: token.fontFamily, fontSize: token.fontSize, fontWeight: token.fontWeight, lineHeight: token.lineHeight, letterSpacing: token.letterSpacing }}>
          {token.name}
        </span>
      );
    }
    return <span className="token-value">{token.value}</span>;
  };

  const renderTokenEdit = (token: any) => (
    <div className="token-edit">
      <input
        type={activeTab === 'colors' ? 'color' : 'text'}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => handleUpdateToken(token.id, editValue)}
        onKeyDown={(e) => e.key === 'Enter' && handleUpdateToken(token.id, editValue)}
        autoFocus
      />
    </div>
  );

  return (
    <div className={`design-system-panel ${compact ? 'compact' : ''}`}>
      {/* Tab Bar */}
      <div className="ds-tab-bar" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`ds-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id as any)}
          >
            <tab.icon size={14} />
            <span>{tab.label}</span>
            <span className="token-count">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="ds-content">
        {activeTab === 'components' ? (
          <ComponentsList
            components={tokens}
            onUpdate={onUpdate}
            onDelete={handleDeleteToken}
          />
        ) : (
          <TokensList
            tokens={tokens}
            onEdit={(id: string, value: string) => {
              setEditingId(id);
              setEditValue(value);
            }}
            onDelete={handleDeleteToken}
            onCopy={handleCopyValue}
            editingId={editingId}
            editValue={editValue}
            renderTokenValue={renderTokenValue}
            renderTokenEdit={renderTokenEdit}
            activeTab={activeTab}
          />
        )}

        {/* Add New Token */}
        <div className="ds-add-section">
          {showAdd === activeTab ? (
            <div className="ds-add-form">
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddToken()}
                placeholder={t('design.system.newTokenName')}
                autoFocus
              />
              <button className="btn primary" onClick={handleAddToken}>
                {t('common.add')}
              </button>
              <button className="btn ghost" onClick={() => setShowAdd(null)}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button className="ds-add-btn" onClick={() => setShowAdd(activeTab)}>
              <Plus size={16} /> {t('design.system.addToken')}
            </button>
          )}
        </div>

        {/* Brand Kit Quick Actions */}
        <div className="ds-brand-kit">
          <h4>{t('design.system.brandKit')}</h4>
          <div className="brand-actions">
            <button className="btn secondary" onClick={() => applyBrandKit()}>
              <CheckCircle2 size={14} /> {t('design.system.applyBrandKit')}
            </button>
            <button className="btn secondary" onClick={() => exportDesignSystem()}>
              <Copy size={14} /> {t('design.system.export')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokensList({
  tokens,
  onEdit,
  onDelete,
  onCopy,
  editingId,
  editValue,
  renderTokenValue,
  renderTokenEdit,
  activeTab,
}: any) {
  const { t } = useTranslation();

  if (tokens.length === 0) {
    return (
      <div className="ds-empty">
        <p>{t('design.system.noTokens')}</p>
      </div>
    );
  }

  return (
    <div className="ds-tokens-list">
      {tokens.map((token: any) => (
        <div key={token.id} className={`ds-token ${editingId === token.id ? 'editing' : ''}`}>
          <div className="token-info" onClick={() => onEdit(token.id, token.value)}>
            {renderTokenValue(token)}
            <div className="token-meta">
              <span className="token-name">{token.name}</span>
              {token.description && <span className="token-desc">{token.description}</span>}
            </div>
          </div>
          <div className="token-actions">
            {editingId === token.id ? (
              renderTokenEdit(token)
            ) : (
              <>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onCopy(token.value); }} title={t('common.copy')}>
                  <Copy size={12} />
                </button>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onEdit(token.id, token.value); }} title={t('common.edit')}>
                  <Edit2 size={12} />
                </button>
                <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onDelete(token.id); }} title={t('common.delete')}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ComponentsList({ components, onUpdate, onDelete }: any) {
  const { t } = useTranslation();

  if (components.length === 0) {
    return (
      <div className="ds-empty">
        <p>{t('design.system.noComponents')}</p>
      </div>
    );
  }

  return (
    <div className="ds-components-list">
      {components.map((comp: any) => (
        <div key={comp.id} className="ds-component">
          <div className="comp-header">
            <span className="comp-name">{comp.name}</span>
            <span className="comp-id">{comp.id.slice(0, 8)}</span>
          </div>
          <div className="comp-props">
            {comp.props?.map((prop: any) => (
              <span key={prop.name} className="prop-badge">{prop.name}: {prop.type}</span>
            ))}
          </div>
          <div className="comp-variants">
            {comp.variants?.map((v: any) => (
              <span key={v.name} className="variant-badge">{v.name}</span>
            ))}
          </div>
          <div className="comp-actions">
            <button className="icon-btn danger" onClick={() => onDelete(comp.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function applyBrandKit() {
  // Apply design system to all canvas elements
  console.log('Apply brand kit to all artifacts');
}

function exportDesignSystem() {
  // Export as JSON/TS config
  console.log('Export design system');
}

export default DesignSystemPanel;