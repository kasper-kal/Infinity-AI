/**
 * TemplatePicker.tsx — Templates by Real Designers
 *
 * Hundreds of pro templates: drop in at any moment mid-flight (not just starting point).
 * Remix multiple templates into something new.
 * Categories: landing pages, dashboards, mobile apps, marketing, docs.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Grid, List, Filter, ChevronDown, ChevronUp, Plus, Star, Heart, LayoutGrid, Monitor, Smartphone, Tablet, FileText, Download, Copy, ExternalLink } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  thumbnail: string;
  previewUrl?: string;
  author: string;
  authorUrl?: string;
  downloads: number;
  rating: number;
  isPro: boolean;
  components: string[]; // Component names included
  screens: TemplateScreen[];
  designSystem?: any;
  createdAt: number;
  updatedAt: number;
}

interface TemplateScreen {
  id: string;
  name: string;
  type: 'frame' | 'page' | 'component';
  thumbnail: string;
  layers: any[]; // Simplified layer data
}

interface TemplatePickerProps {
  onApplyTemplate: (template: Template, screenId?: string) => void;
  onPreviewTemplate: (template: Template) => void;
  compact?: boolean;
}

// Mock template data (in production, this would come from a template registry/backend)
const MOCK_TEMPLATES: Template[] = [
  {
    id: 'tpl-1',
    name: 'SaaS Landing Page',
    description: 'Modern landing page with hero, features, pricing, testimonials, and footer. Fully responsive.',
    category: 'landing-pages',
    tags: ['saas', 'hero', 'pricing', 'testimonials', 'cta'],
    thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop',
    previewUrl: 'https://example.com/saas-landing',
    author: 'Infinity Design Team',
    downloads: 1250,
    rating: 4.8,
    isPro: false,
    components: ['Hero', 'FeatureGrid', 'PricingTable', 'TestimonialCarousel', 'Footer'],
    screens: [
      { id: 's1', name: 'Home', type: 'page', thumbnail: '', layers: [] },
      { id: 's2', name: 'Features', type: 'page', thumbnail: '', layers: [] },
      { id: 's3', name: 'Pricing', type: 'page', thumbnail: '', layers: [] },
    ],
    createdAt: Date.now() - 86400000 * 30,
    updatedAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'tpl-2',
    name: 'Admin Dashboard',
    description: 'Complete admin panel with sidebar navigation, data tables, charts, and user management.',
    category: 'dashboards',
    tags: ['admin', 'sidebar', 'tables', 'charts', 'dark-mode'],
    thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=300&fit=crop',
    previewUrl: 'https://example.com/admin-dashboard',
    author: 'Sarah Chen',
    authorUrl: 'https://twitter.com/sarahchen',
    downloads: 3420,
    rating: 4.9,
    isPro: false,
    components: ['Sidebar', 'Header', 'MetricCards', 'DataTable', 'ChartArea', 'UserMenu'],
    screens: [
      { id: 's1', name: 'Overview', type: 'page', thumbnail: '', layers: [] },
      { id: 's2', name: 'Analytics', type: 'page', thumbnail: '', layers: [] },
      { id: 's3', name: 'Users', type: 'page', thumbnail: '', layers: [] },
      { id: 's4', name: 'Settings', type: 'page', thumbnail: '', layers: [] },
    ],
    createdAt: Date.now() - 86400000 * 60,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'tpl-3',
    name: 'Mobile App Onboarding',
    description: 'Smooth onboarding flow with 4 screens, illustrations, and progress indicator.',
    category: 'mobile-apps',
    tags: ['onboarding', 'illustrations', 'progress', 'ios', 'android'],
    thumbnail: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&h=300&fit=crop',
    previewUrl: 'https://example.com/mobile-onboarding',
    author: 'Marcus Johnson',
    downloads: 2100,
    rating: 4.7,
    isPro: true,
    components: ['OnboardingScreen', 'ProgressDots', 'Illustration', 'CTAButton', 'SkipLink'],
    screens: [
      { id: 's1', name: 'Welcome', type: 'frame', thumbnail: '', layers: [] },
      { id: 's2', name: 'Features', type: 'frame', thumbnail: '', layers: [] },
      { id: 's3', name: 'Permissions', type: 'frame', thumbnail: '', layers: [] },
      { id: 's4', name: 'Get Started', type: 'frame', thumbnail: '', layers: [] },
    ],
    createdAt: Date.now() - 86400000 * 15,
    updatedAt: Date.now() - 86400000 * 1,
  },
  {
    id: 'tpl-4',
    name: 'E-commerce Product Page',
    description: 'High-converting product page with gallery, variants, reviews, and upsells.',
    category: 'landing-pages',
    tags: ['ecommerce', 'product', 'gallery', 'reviews', 'variants'],
    thumbnail: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=300&fit=crop',
    previewUrl: 'https://example.com/ecommerce-product',
    author: 'Infinity Design Team',
    downloads: 890,
    rating: 4.6,
    isPro: false,
    components: ['ProductGallery', 'VariantSelector', 'AddToCart', 'Reviews', 'UpsellCarousel'],
    screens: [
      { id: 's1', name: 'Product', type: 'page', thumbnail: '', layers: [] },
    ],
    createdAt: Date.now() - 86400000 * 45,
    updatedAt: Date.now() - 86400000 * 10,
  },
  {
    id: 'tpl-5',
    name: 'Blog/Documentation Site',
    description: 'Clean documentation layout with sidebar navigation, code blocks, and search.',
    category: 'docs',
    tags: ['docs', 'blog', 'sidebar', 'code', 'search', 'mdx'],
    thumbnail: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=300&fit=crop',
    previewUrl: 'https://example.com/docs-site',
    author: 'Alex Rivera',
    downloads: 1560,
    rating: 4.8,
    isPro: false,
    components: ['DocSidebar', 'DocHeader', 'CodeBlock', 'TOC', 'Search', 'Footer'],
    screens: [
      { id: 's1', name: 'Getting Started', type: 'page', thumbnail: '', layers: [] },
      { id: 's2', name: 'API Reference', type: 'page', thumbnail: '', layers: [] },
      { id: 's3', name: 'Guides', type: 'page', thumbnail: '', layers: [] },
    ],
    createdAt: Date.now() - 86400000 * 90,
    updatedAt: Date.now() - 86400000 * 20,
  },
  {
    id: 'tpl-6',
    name: 'Marketing Campaign Page',
    description: 'Campaign landing page with hero, benefits, social proof, and newsletter signup.',
    category: 'marketing',
    tags: ['marketing', 'campaign', 'lead-gen', 'newsletter', 'social-proof'],
    thumbnail: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=400&h=300&fit=crop',
    previewUrl: 'https://example.com/marketing-campaign',
    author: 'Priya Sharma',
    downloads: 780,
    rating: 4.5,
    isPro: false,
    components: ['CampaignHero', 'BenefitGrid', 'SocialProof', 'NewsletterForm', 'CountdownTimer'],
    screens: [
      { id: 's1', name: 'Campaign', type: 'page', thumbnail: '', layers: [] },
    ],
    createdAt: Date.now() - 86400000 * 7,
    updatedAt: Date.now() - 86400000 * 1,
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'landing-pages', label: 'Landing Pages', icon: Monitor },
  { id: 'dashboards', label: 'Dashboards', icon: LayoutGrid },
  { id: 'mobile-apps', label: 'Mobile Apps', icon: Smartphone },
  { id: 'marketing', label: 'Marketing', icon: Star },
  { id: 'docs', label: 'Docs/Blogs', icon: FileText },
];

export function TemplatePicker({ onApplyTemplate, onPreviewTemplate, compact = false }: TemplatePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState<'popular' | 'recent' | 'rating'>('popular');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('infinity-favorite-templates') || '[]'); }
    catch { return []; }
  });

  const filteredTemplates = useMemo(() => {
    let result = [...MOCK_TEMPLATES];

    if (query) {
      const q = query.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)) ||
        t.author.toLowerCase().includes(q)
      );
    }

    if (category !== 'all') {
      result = result.filter(t => t.category === category);
    }

    switch (sortBy) {
      case 'popular':
        result.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'recent':
        result.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case 'rating':
        result.sort((a, b) => b.rating - a.rating);
        break;
    }

    return result;
  }, [query, category, sortBy]);

  const toggleFavorite = (id: string) => {
    const updated = favorites.includes(id)
      ? favorites.filter(f => f !== id)
      : [...favorites, id];
    setFavorites(updated);
    localStorage.setItem('infinity-favorite-templates', JSON.stringify(updated));
  };

  const isFavorite = (id: string) => favorites.includes(id);

  return (
    <div className={`template-picker ${compact ? 'compact' : ''}`}>
      {/* Header */}
      <div className="tp-header">
        <div className="tp-title">
          <LayoutGrid size={20} />
          <h2>{t('templates.title')}</h2>
        </div>
        <div className="tp-stats">
          <span>{filteredTemplates.length} {t('templates.templates')}</span>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="tp-toolbar">
        <div className="tp-search">
          <Search size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('templates.searchPlaceholder')}
          />
        </div>

        <div className="tp-filters">
          {/* Category */}
          <div className="filter-group">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="filter-select"
            >
              {CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.label}</option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div className="filter-group">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="filter-select"
            >
              <option value="popular">{t('templates.sort.popular')}</option>
              <option value="recent">{t('templates.sort.recent')}</option>
              <option value="rating">{t('templates.sort.rating')}</option>
            </select>
          </div>

          {/* View Mode */}
          <div className="filter-group view-mode">
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>
              <Grid size={16} />
            </button>
            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Templates */}
      <div className="tp-templates">
        {filteredTemplates.length === 0 ? (
          <div className="tp-empty">
            <Search size={48} />
            <p>{t('templates.noResults')}</p>
            <button className="btn secondary" onClick={() => { setQuery(''); setCategory('all'); }}>
              {t('templates.clearFilters')}
            </button>
          </div>
        ) : (
          viewMode === 'grid' ? (
            <div className="tp-grid">
              {filteredTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isFavorite={isFavorite(template.id)}
                  onFavorite={toggleFavorite}
                  onSelect={() => setSelectedTemplate(template)}
                  onApply={() => onApplyTemplate(template)}
                  onPreview={() => onPreviewTemplate(template)}
                />
              ))}
            </div>
          ) : (
            <div className="tp-list">
              {filteredTemplates.map(template => (
                <TemplateListItem
                  key={template.id}
                  template={template}
                  isFavorite={isFavorite(template.id)}
                  onFavorite={toggleFavorite}
                  onSelect={() => setSelectedTemplate(template)}
                  onApply={() => onApplyTemplate(template)}
                  onPreview={() => onPreviewTemplate(template)}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* Detail Modal */}
      {selectedTemplate && showDetail && (
        <TemplateDetailModal
          template={selectedTemplate}
          isFavorite={isFavorite(selectedTemplate.id)}
          onFavorite={toggleFavorite}
          onClose={() => setShowDetail(false)}
          onApply={() => { onApplyTemplate(selectedTemplate); setShowDetail(false); }}
          onPreview={() => { onPreviewTemplate(selectedTemplate); setShowDetail(false); }}
        />
      )}
    </div>
  );
}

interface TemplateCardProps {
  template: Template;
  isFavorite: boolean;
  onFavorite: (id: string) => void;
  onSelect: () => void;
  onApply: () => void;
  onPreview: () => void;
}

function TemplateCard({ template, isFavorite, onFavorite, onSelect, onApply, onPreview }: TemplateCardProps) {
  const { t } = useTranslation();

  return (
    <div className="tp-card" onClick={onSelect}>
      <div className="card-thumbnail">
        <img src={template.thumbnail} alt={template.name} loading="lazy" />
        <div className="card-overlay">
          <button className="overlay-btn" onClick={(e) => { e.stopPropagation(); onPreview(); }}>
            <ExternalLink size={16} />
          </button>
          <button className={`overlay-btn favorite ${isFavorite ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onFavorite(template.id); }}>
            <Heart size={16} />
          </button>
        </div>
        {template.isPro && <span className="pro-badge">{t('templates.pro')}</span>}
        <span className="category-badge">{template.category}</span>
      </div>
      <div className="card-content">
        <h3>{template.name}</h3>
        <p className="card-description">{template.description}</p>
        <div className="card-meta">
          <span className="author">{template.author}</span>
          <div className="card-stats">
            <span><Star size={12} /> {template.rating}</span>
            <span><Download size={12} /> {template.downloads.toLocaleString()}</span>
          </div>
        </div>
        <div className="card-tags">
          {template.tags.slice(0, 3).map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
          {template.tags.length > 3 && <span className="tag more">+{template.tags.length - 3}</span>}
        </div>
        <div className="card-components">
          {template.components.slice(0, 4).map(comp => (
            <span key={comp} className="component-badge">{comp}</span>
          ))}
          {template.components.length > 4 && <span className="component-badge more">+{template.components.length - 4}</span>}
        </div>
        <div className="card-actions">
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); onApply(); }}>
            <Plus size={14} /> {t('templates.apply')}
          </button>
          <button className="btn secondary" onClick={(e) => { e.stopPropagation(); onPreview(); }}>
            <ExternalLink size={14} /> {t('templates.preview')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TemplateListItemProps {
  template: Template;
  isFavorite: boolean;
  onFavorite: (id: string) => void;
  onSelect: () => void;
  onApply: () => void;
  onPreview: () => void;
}

function TemplateListItem({ template, isFavorite, onFavorite, onSelect, onApply, onPreview }: TemplateListItemProps) {
  const { t } = useTranslation();

  return (
    <div className="tp-list-item" onClick={onSelect}>
      <div className="list-thumbnail">
        <img src={template.thumbnail} alt={template.name} loading="lazy" />
        {template.isPro && <span className="pro-badge">{t('templates.pro')}</span>}
      </div>
      <div className="list-content">
        <div className="list-header">
          <h3>{template.name}</h3>
          <span className="category-badge">{template.category}</span>
        </div>
        <p className="list-description">{template.description}</p>
        <div className="list-meta">
          <span className="author">By {template.author}</span>
          <div className="list-stats">
            <span><Star size={12} /> {template.rating}</span>
            <span><Download size={12} /> {template.downloads.toLocaleString()}</span>
          </div>
        </div>
        <div className="list-tags">
          {template.tags.slice(0, 4).map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      </div>
      <div className="list-actions">
        <button className={`icon-btn favorite ${isFavorite ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onFavorite(template.id); }}>
          <Heart size={18} />
        </button>
        <button className="btn secondary" onClick={(e) => { e.stopPropagation(); onPreview(); }}>
          <ExternalLink size={14} /> {t('templates.preview')}
        </button>
        <button className="btn primary" onClick={(e) => { e.stopPropagation(); onApply(); }}>
          <Plus size={14} /> {t('templates.apply')}
        </button>
      </div>
    </div>
  );
}

interface TemplateDetailModalProps {
  template: Template;
  isFavorite: boolean;
  onFavorite: (id: string) => void;
  onClose: () => void;
  onApply: () => void;
  onPreview: () => void;
}

function TemplateDetailModal({ template, isFavorite, onFavorite, onClose, onApply, onPreview }: TemplateDetailModalProps) {
  const { t } = useTranslation();

  return (
    <div className="tp-modal-overlay" onClick={onClose}>
      <div className="tp-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-image">
            <img src={template.thumbnail} alt={template.name} />
          </div>
          <div className="modal-info">
            <div className="modal-meta">
              <span className="category-badge">{template.category}</span>
              {template.isPro && <span className="pro-badge">{t('templates.pro')}</span>}
            </div>
            <h2>{template.name}</h2>
            <p className="modal-description">{template.description}</p>
            <div className="modal-author">
              <span>By {template.author}</span>
              <div className="author-stats">
                <span><Star size={14} /> {template.rating}</span>
                <span><Download size={14} /> {template.downloads.toLocaleString()}</span>
              </div>
            </div>
            <div className="modal-tags">
              {template.tags.map(tag => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <h3>{t('templates.screens')}</h3>
            <div className="screens-grid">
              {template.screens.map(screen => (
                <div key={screen.id} className="screen-item">
                  <span className="screen-type">{screen.type}</span>
                  <span className="screen-name">{screen.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-section">
            <h3>{t('templates.components')}</h3>
            <div className="components-list">
              {template.components.map(comp => (
                <span key={comp} className="component-badge">{comp}</span>
              ))}
            </div>
          </div>

          {template.designSystem && (
            <div className="modal-section">
              <h3>{t('templates.designSystem')}</h3>
              <p className="design-system-preview">This template includes a complete design system with colors, typography, and spacing tokens.</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>
            <ChevronDown size={14} /> {t('common.cancel')}
          </button>
          <button className="btn secondary" onClick={onFavorite.bind(null, template.id)}>
            <Heart size={14} /> {isFavorite ? t('templates.removeFavorite') : t('templates.addFavorite')}
          </button>
          <button className="btn secondary" onClick={onPreview}>
            <ExternalLink size={14} /> {t('templates.preview')}
          </button>
          <button className="btn primary" onClick={onApply}>
            <Plus size={14} /> {t('templates.applyToCanvas')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TemplatePicker;