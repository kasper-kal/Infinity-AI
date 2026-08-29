/**
 * Design Analytics Engine
 *
 * Phase 21: AI-Powered Design Iteration
 * Collects privacy-respecting analytics from preview/deployed apps:
 * - Interaction events (clicks, hovers, form submissions)
 * - Performance metrics (LCP, CLS, FID via Web Vitals)
 * - Funnel analysis for multi-step flows
 * - Dashboard data for BuildView
 */

import { z } from 'zod';
import { db } from '@workspace/db';

// ============================================================================
// Types & Schemas
// ============================================================================

export const InteractionEventSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  shareId: z.string().optional(),
  sessionId: z.string(),
  userId: z.string().optional(),
  type: z.enum(['click', 'hover', 'scroll', 'form_submit', 'form_change', 'navigation', 'error', 'custom']),
  element: z.object({
    selector: z.string(),
    tagName: z.string(),
    className: z.string().optional(),
    id: z.string().optional(),
    text: z.string().optional(),
    xpath: z.string().optional(),
  }),
  position: z.object({
    x: z.number(),
    y: z.number(),
    viewportWidth: z.number(),
    viewportHeight: z.number(),
  }).optional(),
  timestamp: z.number(),
  metadata: z.record(z.any()).optional(),
});

export type InteractionEvent = z.infer<typeof InteractionEventSchema>;

export const WebVitalsSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  shareId: z.string().optional(),
  sessionId: z.string(),
  metrics: z.object({
    lcp: z.number().optional(),      // Largest Contentful Paint (ms)
    fid: z.number().optional(),      // First Input Delay (ms)
    cls: z.number().optional(),      // Cumulative Layout Shift
    fcp: z.number().optional(),      // First Contentful Paint (ms)
    ttfb: z.number().optional(),     // Time to First Byte (ms)
    inp: z.number().optional(),      // Interaction to Next Paint (ms)
  }),
  url: z.string(),
  userAgent: z.string(),
  timestamp: z.number(),
});

export type WebVitals = z.infer<typeof WebVitalsSchema>;

export const FunnelStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  selector: z.string().optional(),
  url: z.string().optional(),
  eventType: z.enum(['click', 'form_submit', 'navigation', 'custom']),
});

export const FunnelConfigSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  steps: z.array(FunnelStepSchema),
  isActive: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type FunnelConfig = z.infer<typeof FunnelConfigSchema>;

export const FunnelSessionSchema = z.object({
  id: z.string(),
  funnelId: z.string(),
  sessionId: z.string(),
  currentStep: z.number().default(0),
  completedSteps: z.array(z.number()).default([]),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  droppedAt: z.number().optional(),
  dropStep: z.number().optional(),
});

export type FunnelSession = z.infer<typeof FunnelSessionSchema>;

export const AnalyticsAggregatesSchema = z.object({
  projectId: z.string(),
  shareId: z.string().optional(),
  period: z.enum(['hour', 'day', 'week', 'month']),
  periodStart: z.number(),
  periodEnd: z.number(),
  interactions: z.object({
    total: z.number(),
    byType: z.record(z.number()),
    byElement: z.record(z.number()),
    topElements: z.array(z.object({
      selector: z.string(),
      count: z.number(),
    })),
  }),
  vitals: z.object({
    lcp: z.object({ p50: z.number(), p75: z.number(), p95: z.number() }).optional(),
    fid: z.object({ p50: z.number(), p75: z.number(), p95: z.number() }).optional(),
    cls: z.object({ p50: z.number(), p75: z.number(), p95: z.number() }).optional(),
    fcp: z.object({ p50: z.number(), p75: z.number(), p95: z.number() }).optional(),
    inp: z.object({ p50: z.number(), p75: z.number(), p95: z.number() }).optional(),
    sampleCount: z.number(),
  }),
  funnels: z.array(z.object({
    funnelId: z.string(),
    funnelName: z.string(),
    sessions: z.number(),
    completions: z.number(),
    dropOffRate: z.number(),
    avgTimeToComplete: z.number().optional(),
    stepDropOffs: z.array(z.object({
      stepIndex: z.number(),
      stepName: z.string(),
      sessions: z.number(),
      dropOffs: z.number(),
    })),
  })),
});

export type AnalyticsAggregates = z.infer<typeof AnalyticsAggregatesSchema>;

// ============================================================================
// Analytics Collector (Client-side script to inject)
// ============================================================================

export const ANALYTICS_COLLECTOR_SCRIPT = `
(function() {
  'use strict';

  const CONFIG = {
    endpoint: '__ENDPOINT__',
    projectId: '__PROJECT_ID__',
    shareId: '__SHARE_ID__',
    sessionId: '__SESSION_ID__',
    sampleRate: 1.0,
    enableWebVitals: true,
    enableInteractions: true,
    enableFunnels: true,
  };

  let sessionId = CONFIG.sessionId;
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    sessionStorage.setItem('infinity_analytics_session', sessionId);
  } else {
    sessionId = sessionStorage.getItem('infinity_analytics_session') || sessionId;
  }

  const queue = [];
  let isSending = false;

  function sendBatch() {
    if (isSending || queue.length === 0) return;
    isSending = true;

    const batch = queue.splice(0, 50);
    fetch(CONFIG.endpoint + '/api/infinity/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    }).catch(() => {
      // Re-queue on failure
      queue.unshift(...batch);
    }).finally(() => {
      isSending = false;
      if (queue.length > 0) sendBatch();
    });
  }

  function enqueue(event) {
    if (Math.random() > CONFIG.sampleRate) return;
    queue.push({ ...event, sessionId, timestamp: Date.now() });
    if (queue.length >= 10) sendBatch();
  }

  // Interaction tracking
  if (CONFIG.enableInteractions) {
    ['click', 'mouseover', 'submit', 'change'].forEach(eventType => {
      document.addEventListener(eventType, (e) => {
        const target = e.target.closest('[data-analytics], button, a, input, select, textarea, [role="button"]');
        if (!target) return;

        const rect = target.getBoundingClientRect();
        enqueue({
          type: eventType === 'mouseover' ? 'hover' : eventType === 'submit' ? 'form_submit' : eventType,
          element: {
            selector: getSelector(target),
            tagName: target.tagName.toLowerCase(),
            className: target.className || '',
            id: target.id || '',
            text: target.textContent?.slice(0, 100) || '',
            xpath: getXPath(target),
          },
          position: {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
          metadata: {
            eventType,
            href: target.href || '',
            name: target.name || '',
            type: target.type || '',
          },
        });
      }, { passive: true, capture: true });
    });

    // Scroll tracking (throttled)
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        enqueue({
          type: 'scroll',
          element: { selector: 'window', tagName: 'window', className: '', id: '', text: '', xpath: '' },
          position: { x: window.scrollX, y: window.scrollY, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight },
          metadata: { scrollDepth: Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100) },
        });
      }, 500);
    }, { passive: true });
  }

  // Web Vitals
  if (CONFIG.enableWebVitals && 'PerformanceObserver' in window) {
    try {
      const vitals = {};

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') {
            vitals.lcp = entry.startTime;
          } else if (entry.entryType === 'first-input') {
            vitals.fid = entry.processingStart - entry.startTime;
          } else if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
            vitals.cls = (vitals.cls || 0) + entry.value;
          } else if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') {
            vitals.fcp = entry.startTime;
          } else if (entry.entryType === 'navigation') {
            vitals.ttfb = entry.responseStart - entry.requestStart;
          } else if (entry.entryType === 'event' && entry.name === 'interaction') {
            vitals.inp = entry.duration;
          }
        }

        // Send vitals when page is hidden or unloading
        const sendVitals = () => {
          if (Object.keys(vitals).length > 0) {
            enqueue({
              type: 'web_vitals',
              element: { selector: 'document', tagName: 'document', className: '', id: '', text: '', xpath: '' },
              metadata: { vitals, url: window.location.href, userAgent: navigator.userAgent },
            });
            sendBatch();
          }
        };

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') sendVitals();
        });
        window.addEventListener('beforeunload', sendVitals);

        // Also send after 5s for SPA navigation
        setTimeout(sendVitals, 5000);
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'first-input') {
            vitals.fid = entry.processingStart - entry.startTime;
          }
        }
      }).observe({ type: 'first-input', buffered: true });

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
            vitals.cls = (vitals.cls || 0) + entry.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') {
            vitals.fcp = entry.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'navigation') {
            vitals.ttfb = entry.responseStart - entry.requestStart;
          }
        }
      }).observe({ type: 'navigation', buffered: true });

      if ('PerformanceEventTiming' in window) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            vitals.inp = entry.duration;
          }
        }).observe({ type: 'event', buffered: true });
      }
    } catch (e) {
      console.warn('Web Vitals not supported:', e);
    }
  }

  // Funnel tracking
  if (CONFIG.enableFunnels) {
    window.infinityFunnels = window.infinityFunnels || {};
    window.infinityFunnels.track = (funnelId, stepIndex) => {
      enqueue({
        type: 'funnel_step',
        element: { selector: 'funnel', tagName: 'funnel', className: '', id: '', text: '', xpath: '' },
        metadata: { funnelId, stepIndex, url: window.location.href },
      });
    };
  }

  // Helper: Generate CSS selector
  function getSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.dataset.analytics) return '[data-analytics="' + el.dataset.analytics + '"]';
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.tagName.toLowerCase();
      if (el.className) {
        const classes = el.className.split(' ').filter(c => c && !c.startsWith('infinity-')).slice(0, 3);
        if (classes.length) selector += '.' + classes.join('.');
      }
      path.unshift(selector);
      el = el.parentElement;
      if (path.length > 5) break;
    }
    return path.join(' > ');
  }

  // Helper: Generate XPath
  function getXPath(el) {
    if (el.id) return '//*[@id="' + el.id + '"]';
    const paths = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      const siblings = el.parentNode?.children || [];
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === el) { index = i + 1; break; }
        if (siblings[i].tagName === el.tagName) index++;
      }
      paths.unshift(el.tagName.toLowerCase() + '[' + index + ']');
      el = el.parentElement;
      if (paths.length > 10) break;
    }
    return '/' + paths.join('/');
  }

  // Periodic flush
  setInterval(sendBatch, 10000);
  window.addEventListener('beforeunload', sendBatch);

  console.log('[Infinity Analytics] Initialized for project ' + CONFIG.projectId);
})();
`;

// ============================================================================
// Server-side Analytics Engine
// ============================================================================

export class DesignAnalyticsEngine {
  private static instance: DesignAnalyticsEngine;
  private batchBuffer: InteractionEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000;

  static getInstance(): DesignAnalyticsEngine {
    if (!DesignAnalyticsEngine.instance) {
      DesignAnalyticsEngine.instance = new DesignAnalyticsEngine();
    }
    return DesignAnalyticsEngine.instance;
  }

  constructor() {
    this.startFlushTimer();
  }

  private startFlushTimer() {
    this.flushInterval = setInterval(() => this.flushBatch(), this.FLUSH_INTERVAL_MS);
  }

  async recordInteraction(event: InteractionEvent): Promise<void> {
    this.batchBuffer.push(event);
    if (this.batchBuffer.length >= this.BATCH_SIZE) {
      await this.flushBatch();
    }
  }

  async recordWebVitals(vitals: WebVitals): Promise<void> {
    // Store web vitals separately for aggregation
    await db.insert(webVitalsTable).values({
      id: vitals.id,
      projectId: vitals.projectId,
      shareId: vitals.shareId,
      sessionId: vitals.sessionId,
      lcp: vitals.metrics.lcp,
      fid: vitals.metrics.fid,
      cls: vitals.metrics.cls,
      fcp: vitals.metrics.fcp,
      ttfb: vitals.metrics.ttfb,
      inp: vitals.metrics.inp,
      url: vitals.url,
      userAgent: vitals.userAgent,
      timestamp: vitals.timestamp,
    });
  }

  async recordFunnelStep(funnelId: string, sessionId: string, stepIndex: number): Promise<void> {
    // Update funnel session progress
    const existing = await db.query.funnelSessions.findFirst({
      where: (fs, { eq, and }) => and(eq(fs.funnelId, funnelId), eq(fs.sessionId, sessionId)),
    });

    if (existing) {
      const completedSteps = [...new Set([...existing.completedSteps, stepIndex])];
      await db.update(funnelSessionsTable)
        .set({ currentStep: Math.max(existing.currentStep, stepIndex), completedSteps })
        .where((fs, { eq, and }) => and(eq(fs.funnelId, funnelId), eq(fs.sessionId, sessionId)));
    } else {
      await db.insert(funnelSessionsTable).values({
        id: `funnel_sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        funnelId,
        sessionId,
        currentStep: stepIndex,
        completedSteps: [stepIndex],
        startedAt: Date.now(),
      });
    }
  }

  async completeFunnel(funnelId: string, sessionId: string): Promise<void> {
    await db.update(funnelSessionsTable)
      .set({ completedAt: Date.now() })
      .where((fs, { eq, and }) => and(eq(fs.funnelId, funnelId), eq(fs.sessionId, sessionId)));
  }

  async dropFunnel(funnelId: string, sessionId: string, dropStep: number): Promise<void> {
    await db.update(funnelSessionsTable)
      .set({ droppedAt: Date.now(), dropStep })
      .where((fs, { eq, and }) => and(eq(fs.funnelId, funnelId), eq(fs.sessionId, sessionId)));
  }

  private async flushBatch(): Promise<void> {
    if (this.batchBuffer.length === 0) return;

    const batch = this.batchBuffer.splice(0, this.BATCH_SIZE);

    try {
      await db.insert(interactionEventsTable).values(
        batch.map(e => ({
          id: e.id,
          projectId: e.projectId,
          shareId: e.shareId,
          sessionId: e.sessionId,
          userId: e.userId,
          type: e.type,
          elementSelector: e.element.selector,
          elementTagName: e.element.tagName,
          elementClassName: e.element.className,
          elementId: e.element.id,
          elementText: e.element.text,
          elementXPath: e.element.xpath,
          positionX: e.position?.x,
          positionY: e.position?.y,
          viewportWidth: e.position?.viewportWidth,
          viewportHeight: e.position?.viewportHeight,
          metadata: e.metadata,
          timestamp: e.timestamp,
        }))
      );
    } catch (error) {
      console.error('Failed to flush analytics batch:', error);
      // Re-add to buffer for retry
      this.batchBuffer.unshift(...batch);
    }
  }

  async getAggregates(
    projectId: string,
    shareId: string | undefined,
    period: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<AnalyticsAggregates> {
    const now = Date.now();
    const periodMs = {
      hour: 3600000,
      day: 86400000,
      week: 604800000,
      month: 2592000000,
    }[period];
    const periodStart = now - periodMs;
    const periodEnd = now;

    // Query interactions
    const interactions = await db.query.interactionEvents.findMany({
      where: (ie, { eq, and, gte, lte }) => and(
        eq(ie.projectId, projectId),
        shareId ? eq(ie.shareId, shareId) : undefined,
        gte(ie.timestamp, periodStart),
        lte(ie.timestamp, periodEnd)
      ),
    });

    // Query web vitals
    const vitals = await db.query.webVitals.findMany({
      where: (wv, { eq, and, gte, lte }) => and(
        eq(wv.projectId, projectId),
        shareId ? eq(wv.shareId, shareId) : undefined,
        gte(wv.timestamp, periodStart),
        lte(wv.timestamp, periodEnd)
      ),
    });

    // Query funnels
    const funnels = await db.query.funnelConfigs.findMany({
      where: (fc, { eq }) => eq(fc.projectId, projectId),
    });

    const funnelData = await Promise.all(funnels.map(async (funnel) => {
      const sessions = await db.query.funnelSessions.findMany({
        where: (fs, { eq, gte, lte }) => and(
          eq(fs.funnelId, funnel.id),
          gte(fs.startedAt, periodStart),
          lte(fs.startedAt, periodEnd)
        ),
      });

      const completions = sessions.filter(s => s.completedAt).length;
      const stepDropOffs = funnel.steps.map((step, index) => {
        const stepSessions = sessions.filter(s => s.currentStep >= index).length;
        const dropOffs = sessions.filter(s => s.dropStep === index).length;
        return { stepIndex: index, stepName: step.name, sessions: stepSessions, dropOffs };
      });

      return {
        funnelId: funnel.id,
        funnelName: funnel.name,
        sessions: sessions.length,
        completions,
        dropOffRate: sessions.length > 0 ? 1 - completions / sessions.length : 0,
        avgTimeToComplete: completions > 0
          ? sessions.filter(s => s.completedAt).reduce((sum, s) => sum + (s.completedAt! - s.startedAt), 0) / completions
          : undefined,
        stepDropOffs,
      };
    }));

    // Calculate percentiles
    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const sorted = arr.sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * p)];
    };

    const lcpValues = vitals.filter(v => v.lcp).map(v => v.lcp!);
    const fidValues = vitals.filter(v => v.fid).map(v => v.fid!);
    const clsValues = vitals.filter(v => v.cls).map(v => v.cls!);
    const fcpValues = vitals.filter(v => v.fcp).map(v => v.fcp!);
    const inpValues = vitals.filter(v => v.inp).map(v => v.inp!);

    const byType: Record<string, number> = {};
    const byElement: Record<string, number> = {};

    for (const event of interactions) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      byElement[event.element.selector] = (byElement[event.element.selector] || 0) + 1;
    }

    const topElements = Object.entries(byElement)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([selector, count]) => ({ selector, count }));

    return {
      projectId,
      shareId,
      period,
      periodStart,
      periodEnd,
      interactions: {
        total: interactions.length,
        byType,
        byElement,
        topElements,
      },
      vitals: {
        lcp: lcpValues.length ? { p50: percentile(lcpValues, 0.5), p75: percentile(lcpValues, 0.75), p95: percentile(lcpValues, 0.95) } : undefined,
        fid: fidValues.length ? { p50: percentile(fidValues, 0.5), p75: percentile(fidValues, 0.75), p95: percentile(fidValues, 0.95) } : undefined,
        cls: clsValues.length ? { p50: percentile(clsValues, 0.5), p75: percentile(clsValues, 0.75), p95: percentile(clsValues, 0.95) } : undefined,
        fcp: fcpValues.length ? { p50: percentile(fcpValues, 0.5), p75: percentile(fcpValues, 0.75), p95: percentile(fcpValues, 0.95) } : undefined,
        inp: inpValues.length ? { p50: percentile(inpValues, 0.5), p75: percentile(inpValues, 0.75), p95: percentile(inpValues, 0.95) } : undefined,
        sampleCount: vitals.length,
      },
      funnels: funnelData,
    };
  }

  async collectEvents(events: InteractionEvent[], options: { projectId?: string; shareId?: string } = {}): Promise<{ success: boolean; collected: number }> {
    for (const event of events) {
      await this.recordInteraction({
        ...event,
        projectId: options.projectId || event.projectId,
        shareId: options.shareId || event.shareId,
      });
    }
    return { success: true, collected: events.length };
  }

  getFunnelAggregates(projectId: string, shareId: string | undefined) {
    // This is synchronous - return cached or compute from getAggregates
    // For now, return empty array - will be populated when getAggregates is called
    return [];
  }

  getClientScript(): string {
    return ANALYTICS_COLLECTOR_SCRIPT
      .replace('__ENDPOINT__', '/api/infinity/ui-builder/analytics/collect')
      .replace('__PROJECT_ID__', '')
      .replace('__SHARE_ID__', '')
      .replace('__SESSION_ID__', `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  }

  async getHeatmapData(
    projectId: string,
    shareId: string | undefined,
    viewportWidth: number = 1440,
    viewportHeight: number = 900
  ): Promise<Array<{ x: number; y: number; count: number }>> {
    const events = await db.query.interactionEvents.findMany({
      where: (ie, { eq, and }) => and(
        eq(ie.projectId, projectId),
        shareId ? eq(ie.shareId, shareId) : undefined,
        // Only click/hover for heatmap
      ),
    });

    const heatmap: Record<string, number> = {};
    const cellSize = 20;

    for (const event of events) {
      if (!event.position) continue;
      const x = Math.floor(event.position.x / cellSize) * cellSize;
      const y = Math.floor(event.position.y / cellSize) * cellSize;
      const key = `${x},${y}`;
      heatmap[key] = (heatmap[key] || 0) + 1;
    }

    return Object.entries(heatmap).map(([key, count]) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y, count };
    });
  }

  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushBatch();
  }
}

// Database table definitions (inline for reference - actual tables in schema)
const interactionEventsTable = {
  name: 'interaction_events',
  // id, projectId, shareId, sessionId, userId, type, elementSelector, elementTagName,
  // elementClassName, elementId, elementText, elementXPath, positionX, positionY,
  // viewportWidth, viewportHeight, metadata, timestamp
};

const webVitalsTable = {
  name: 'web_vitals',
  // id, projectId, shareId, sessionId, lcp, fid, cls, fcp, ttfb, inp, url, userAgent, timestamp
};

const funnelSessionsTable = {
  name: 'funnel_sessions',
  // id, funnelId, sessionId, currentStep, completedSteps, startedAt, completedAt, droppedAt, dropStep
};

const funnelConfigsTable = {
  name: 'funnel_configs',
  // id, projectId, name, steps, isActive, createdAt, updatedAt
};

// ============================================================================
// Public API
// ============================================================================

export async function injectAnalyticsScript(
  projectId: string,
  shareId: string | undefined,
  sessionId: string,
  endpoint: string
): Promise<string> {
  return ANALYTICS_COLLECTOR_SCRIPT
    .replace('__ENDPOINT__', endpoint)
    .replace('__PROJECT_ID__', projectId)
    .replace('__SHARE_ID__', shareId || '')
    .replace('__SESSION_ID__', sessionId);
}

export function getAnalyticsEngine(): DesignAnalyticsEngine {
  return DesignAnalyticsEngine.getInstance();
}