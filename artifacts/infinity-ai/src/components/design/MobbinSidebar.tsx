/**
 * MobbinSidebar.tsx — Mobbin Integration Sidebar
 *
 * 600k+ real UI/UX screens from 1000+ apps.
 * Search/reference library built into canvas sidebar.
 * Drag patterns from Mobbin directly onto canvas.
 * Competitive teardowns: pull competitor flow → generate comparable layout.
 * No separate Mobbin account needed.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Grid, List, ChevronDown, ChevronUp, ExternalLink, Download, Plus, Star, Heart, Hash, LayoutGrid, Smartphone, Monitor, Layers } from 'lucide-react';
import { MobbinClient, MobbinScreen, MobbinSearchQuery, MobbinSearchResult } from '@/lib/mobbin-client';

interface MobbinSidebarProps {
  client: MobbinClient;
  onAddToCanvas: (screen: MobbinScreen) => void;
  compact?: boolean;
}

export function MobbinSidebar({ client, onAddToCanvas, compact = false }: MobbinSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MobbinScreen[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedScreen, setSelectedScreen] = useState<MobbinScreen | null>(null);
  const [filters, setFilters] = useState<MobbinSearchQuery>({});
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Load metadata on mount
  useEffect(() => {
    setCategories(client.getCategories());
    setTags(client.getAllTags());
    setPatterns(client.getAllPatterns());
    doSearch();
  }, [client]);

  // Infinite scroll
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          doSearch(true);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading]);

  const doSearch = useCallback(async (loadMore = false) => {
    if (loading) return;
    setLoading(true);

    try {
      const searchQuery: MobbinSearchQuery = {
        query: query || undefined,
        category: filters.category,
        platform: filters.platform,
        tags: filters.tags?.length ? filters.tags : undefined,
        patterns: filters.patterns?.length ? filters.patterns : undefined,
        limit: 20,
        offset: loadMore ? offset + 20 : 0,
      };

      const result = await client.search(searchQuery);

      if (loadMore) {
        setResults(prev => [...prev, ...result.screens]);
      } else {
        setResults(result.screens);
      }
      setOffset(searchQuery.offset);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error('Mobbin search failed:', error);
    } finally {
      setLoading(false);
    }
  }, [client, query, filters, offset, loading]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      doSearch(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, filters]);

  const handleSelect = (screen: MobbinScreen) => {
    setSelectedScreen(screen);
  };

  const handleAdd = (screen: MobbinScreen) => {
    onAddToCanvas(screen);
    // Show toast or feedback
  };

  const toggleFilter = (type: 'tags' | 'patterns', value: string) => {
    const current = filters[type] || [];
    const updated = current.includes(value)
      ? current.filter((v: string) => v !== value)
      : [...current, value];
    setFilters((prev: any) => ({ ...prev, [type]: updated }));
    setOffset(0);
  };

  const clearFilters = () => {
    setFilters({} as any);
    setOffset(0);
  };

  const hasActiveFilters = filters.category || filters.platform || (filters.tags?.length || 0) > 0 || (filters.patterns?.length || 0) > 0;

  return (
    <div className={`mobbin-sidebar ${compact ? 'compact' : ''}`}>
      {/* Header */}
      <div className="mobbin-header">
        <div className="mobbin-logo">
          <Hash size={18} />
          <span>Mobbin</span>
        </div>
        <div className="mobbin-stats">
          <span className="stat">{results.length} {t('mobbin.screens')}</span>
          {hasActiveFilters && (
            <button className="clear-filters" onClick={clearFilters}>
              <ChevronUp size={12} /> {t('mobbin.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="mobbin-search">
        <Search size={16} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('mobbin.searchPlaceholder')}
        />
      </div>

      {/* Filters */}
      <button className="mobbin-filters-toggle" onClick={() => setShowFilters(!showFilters)}>
        <Filter size={14} />
        <span>{t('mobbin.filters')}</span>
        <ChevronDown size={12} className={showFilters ? 'open' : ''} />
      </button>

      {showFilters && (
        <div className="mobbin-filters">
          {/* Category */}
          <div className="filter-group">
            <label>{t('mobbin.category')}</label>
            <select
              value={filters.category || ''}
              onChange={(e) => setFilters((prev: any) => ({ ...prev, category: e.target.value || undefined }))}
            >
              <option value="">{t('mobbin.allCategories')}</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Platform */}
          <div className="filter-group">
            <label>{t('mobbin.platform')}</label>
            <div className="platform-buttons">
              {['web', 'ios', 'android'].map(p => (
                <button
                  key={p}
                  className={filters.platform === p ? 'active' : ''}
                  onClick={() => setFilters((prev: any) => ({ ...prev, platform: filters.platform === p ? undefined : p }))}
                >
                  {p === 'web' ? <Monitor size={14} /> : <Smartphone size={14} />}
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="filter-group">
            <label>{t('mobbin.tags')}</label>
            <div className="filter-chips">
              {tags.slice(0, 12).map(tag => (
                <button
                  key={tag}
                  className={`filter-chip ${filters.tags?.includes(tag) ? 'active' : ''}`}
                  onClick={() => toggleFilter('tags', tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Patterns */}
          <div className="filter-group">
            <label>{t('mobbin.patterns')}</label>
            <div className="filter-chips">
              {patterns.slice(0, 12).map(pattern => (
                <button
                  key={pattern}
                  className={`filter-chip ${filters.patterns?.includes(pattern) ? 'active' : ''}`}
                  onClick={() => toggleFilter('patterns', pattern)}
                >
                  {pattern}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* View Mode */}
      <div className="mobbin-view-mode">
        <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>
          <LayoutGrid size={16} />
        </button>
        <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
          <List size={16} />
        </button>
      </div>

      {/* Results */}
      <div className="mobbin-results">
        {loading && results.length === 0 && (
          <div className="mobbin-loading">
            <div className="spinner" />
            <span>{t('mobbin.loading')}</span>
          </div>
        )}

        {results.length === 0 && !loading && (
          <div className="mobbin-empty">
            <Hash size={48} />
            <p>{t('mobbin.noResults')}</p>
          </div>
        )}

        {viewMode === 'grid' ? (
          <div className="mobbin-grid">
            {results.map(screen => (
              <MobbinCard
                key={screen.id}
                screen={screen}
                selected={selectedScreen?.id === screen.id}
                onSelect={handleSelect}
                onAdd={handleAdd}
              />
            ))}
            <div ref={loadMoreRef} className="load-more-trigger" />
          </div>
        ) : (
          <div className="mobbin-list">
            {results.map(screen => (
              <MobbinListItem
                key={screen.id}
                screen={screen}
                selected={selectedScreen?.id === screen.id}
                onSelect={handleSelect}
                onAdd={handleAdd}
              />
            ))}
            <div ref={loadMoreRef} className="load-more-trigger" />
          </div>
        )}

        {loading && results.length > 0 && (
          <div className="mobbin-loading-more">
            <div className="spinner" />
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedScreen && (
        <MobbinDetailPanel
          screen={selectedScreen}
          onClose={() => setSelectedScreen(null)}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}

interface MobbinCardProps {
  screen: MobbinScreen;
  selected: boolean;
  onSelect: (screen: MobbinScreen) => void;
  onAdd: (screen: MobbinScreen) => void;
}

function MobbinCard({ screen, selected, onSelect, onAdd }: MobbinCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`mobbin-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(screen)}
    >
      <div className="card-image">
        {screen.thumbnailUrl ? (
          <img src={screen.thumbnailUrl} alt={screen.screenName} loading="lazy" />
        ) : (
          <div className="image-placeholder">
            <Layers size={32} />
          </div>
        )}
        <div className="card-overlay">
          <button className="overlay-btn" onClick={(e) => { e.stopPropagation(); onAdd(screen); }} title={t('mobbin.addToCanvas')}>
            <Plus size={16} />
          </button>
          <a href={screen.sourceUrl} target="_blank" rel="noopener noreferrer" className="overlay-btn" onClick={(e) => e.stopPropagation()}>
            <ExternalLink size={16} />
          </a>
        </div>
        <div className="card-platform">
          <span className={`platform-badge ${screen.platform}`}>
            {screen.platform === 'web' && <Monitor size={10} />}
            {screen.platform === 'ios' && <Smartphone size={10} />}
            {screen.platform === 'android' && <Smartphone size={10} />}
            {screen.platform}
          </span>
        </div>
      </div>
      <div className="card-info">
        <h4 className="card-name">{screen.screenName}</h4>
        <p className="card-app">{screen.appName}</p>
        <div className="card-tags">
          {screen.tags.slice(0, 3).map((tag: string) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
          {screen.tags.length > 3 && <span className="tag more">+{screen.tags.length - 3}</span>}
        </div>
        <div className="card-colors">
          {screen.colors.slice(0, 4).map((color: string, i: number) => (
            <div key={i} className="color-dot" style={{ backgroundColor: color }} title={color} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface MobbinListItemProps {
  screen: MobbinScreen;
  selected: boolean;
  onSelect: (screen: MobbinScreen) => void;
  onAdd: (screen: MobbinScreen) => void;
}

function MobbinListItem({ screen, selected, onSelect, onAdd }: MobbinListItemProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`mobbin-list-item ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(screen)}
    >
      <div className="list-thumbnail">
        {screen.thumbnailUrl ? (
          <img src={screen.thumbnailUrl} alt={screen.screenName} loading="lazy" />
        ) : (
          <div className="thumb-placeholder"><Layers size={24} /></div>
        )}
      </div>
      <div className="list-info">
        <h4>{screen.screenName}</h4>
        <p className="list-app">{screen.appName}</p>
        <div className="list-meta">
          <span className={`platform-badge ${screen.platform}`}>
            {screen.platform}
          </span>
          <span className="category-badge">{screen.appCategory}</span>
        </div>
      </div>
      <div className="list-actions">
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onAdd(screen); }} title={t('mobbin.addToCanvas')}>
          <Plus size={16} />
        </button>
        <a href={screen.sourceUrl} target="_blank" rel="noopener noreferrer" className="icon-btn" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}

interface MobbinDetailPanelProps {
  screen: MobbinScreen;
  onClose: () => void;
  onAdd: (screen: MobbinScreen) => void;
}

function MobbinDetailPanel({ screen, onClose, onAdd }: MobbinDetailPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="mobbin-detail">
      <div className="detail-header">
        <button className="icon-btn" onClick={onClose}>
          <ChevronDown size={20} />
        </button>
        <h3>{screen.screenName}</h3>
        <div className="detail-app">
          <span className={`platform-badge ${screen.platform}`}>{screen.platform}</span>
          {screen.appName}
        </div>
      </div>

      <div className="detail-image">
        {screen.imageUrl ? (
          <img src={screen.imageUrl} alt={screen.screenName} />
        ) : (
          <div className="detail-placeholder"><Layers size={48} /></div>
        )}
      </div>

      <div className="detail-meta">
        <div className="meta-section">
          <h4>{t('mobbin.tags')}</h4>
          <div className="tags">
            {screen.tags.map((tag: string) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        </div>

        <div className="meta-section">
          <h4>{t('mobbin.patterns')}</h4>
          <div className="tags">
            {screen.patterns.map((pattern: string) => (
              <span key={pattern} className="tag pattern">{pattern}</span>
            ))}
          </div>
        </div>

        <div className="meta-section">
          <h4>{t('mobbin.components')}</h4>
          <div className="tags">
            {screen.components.map((comp: string) => (
              <span key={comp} className="tag component">{comp}</span>
            ))}
          </div>
        </div>

        <div className="meta-section">
          <h4>{t('mobbin.colors')}</h4>
          <div className="color-palette">
            {screen.colors.map((color: string, i: number) => (
              <div
                key={i}
                className="color-swatch"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="btn primary" onClick={() => onAdd(screen)}>
          <Plus size={16} /> {t('mobbin.addToCanvas')}
        </button>
        <a href={screen.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn secondary">
          <ExternalLink size={16} /> {t('mobbin.viewOnMobbin')}
        </a>
      </div>
    </div>
  );
}

export default MobbinSidebar;