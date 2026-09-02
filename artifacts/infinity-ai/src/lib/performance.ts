/**
 * Performance Benchmarking & Profiling Library (Frontend/Browser Version)
 * Phase 31: Cursor-Level Performance & Polish
 *
 * Provides benchmarking utilities, performance monitoring, and profiling
 * for optimizing Infinity to match Cursor's speed and reliability.
 */

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
}

export interface ProfileResult {
  functionName: string;
  callCount: number;
  totalTimeMs: number;
  avgTimeMs: number;
  maxTimeMs: number;
  selfTimeMs: number;
}

export interface PerformanceMetrics {
  timestamp: number;
  operation: string;
  durationMs: number;
  memoryUsedMB: number;
  metadata?: Record<string, unknown>;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
  size: number;
}

export interface PerformanceConfig {
  enableProfiling: boolean;
  enableMetrics: boolean;
  metricsRetentionMs: number;
  maxMetricsEntries: number;
  sampleRate: number; // 0-1
}

/**
 * High-resolution timer utility (uses performance.now in browser)
 */
export class HighResTimer {
  private startTime: number = 0;
  private endTime: number = 0;
  private running = false;

  start(): void {
    this.startTime = performance.now();
    this.running = true;
  }

  stop(): number {
    if (!this.running) {
      return 0;
    }
    this.endTime = performance.now();
    this.running = false;
    return this.endTime - this.startTime;
  }

  getElapsed(): number {
    if (this.running) {
      return performance.now() - this.startTime;
    }
    return this.endTime - this.startTime;
  }

  reset(): void {
    this.startTime = 0;
    this.endTime = 0;
    this.running = false;
  }
}

/**
 * Benchmark runner for measuring operation performance
 */
export class BenchmarkRunner {
  private results: Map<string, BenchmarkResult> = new Map();

  async run<T>(
    name: string,
    fn: () => Promise<T> | T,
    iterations: number = 100,
    warmupIterations: number = 10
  ): Promise<BenchmarkResult> {
    // Warmup
    for (let i = 0; i < warmupIterations; i++) {
      await fn();
    }

    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const timer = new HighResTimer();
      timer.start();
      await fn();
      const elapsed = timer.stop();
      times.push(elapsed);
    }

    const sorted = [...times].sort((a, b) => a - b);
    const total = times.reduce((a, b) => a + b, 0);
    const avg = total / iterations;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    const result: BenchmarkResult = {
      name,
      iterations,
      totalMs: total,
      avgMs: avg,
      minMs: min,
      maxMs: max,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      opsPerSec: 1000 / avg,
    };

    this.results.set(name, result);
    return result;
  }

  getResult(name: string): BenchmarkResult | undefined {
    return this.results.get(name);
  }

  getAllResults(): BenchmarkResult[] {
    return Array.from(this.results.values());
  }

  clear(): void {
    this.results.clear();
  }
}

/**
 * Function profiler for identifying hot paths
 */
export class Profiler {
  private profiles: Map<string, ProfileResult> = new Map();
  private callStack: Array<{ name: string; startTime: number }> = [];
  private enabled = false;

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enter(functionName: string): void {
    if (!this.enabled) return;
    this.callStack.push({ name: functionName, startTime: performance.now() });
  }

  exit(functionName: string): void {
    if (!this.enabled) return;
    const entry = this.callStack.pop();
    if (!entry || entry.name !== functionName) return;

    const duration = performance.now() - entry.startTime;
    const existing = this.profiles.get(functionName);

    if (existing) {
      existing.callCount++;
      existing.totalTimeMs += duration;
      existing.avgTimeMs = existing.totalTimeMs / existing.callCount;
      existing.maxTimeMs = Math.max(existing.maxTimeMs, duration);
    } else {
      this.profiles.set(functionName, {
        functionName,
        callCount: 1,
        totalTimeMs: duration,
        avgTimeMs: duration,
        maxTimeMs: duration,
        selfTimeMs: duration,
      });
    }
  }

  profile<T>(functionName: string, fn: () => T): T {
    this.enter(functionName);
    try {
      return fn();
    } finally {
      this.exit(functionName);
    }
  }

  async profileAsync<T>(functionName: string, fn: () => Promise<T>): Promise<T> {
    this.enter(functionName);
    try {
      return await fn();
    } finally {
      this.exit(functionName);
    }
  }

  getProfile(functionName: string): ProfileResult | undefined {
    return this.profiles.get(functionName);
  }

  getAllProfiles(): ProfileResult[] {
    return Array.from(this.profiles.values()).sort((a, b) => b.totalTimeMs - a.totalTimeMs);
  }

  clear(): void {
    this.profiles.clear();
    this.callStack = [];
  }

  printReport(topN: number = 20): void {
    console.log('\n=== Performance Profile Report ===');
    const profiles = this.getAllProfiles().slice(0, topN);
    for (const p of profiles) {
      console.log(`${p.functionName}: ${p.callCount} calls, ${p.totalTimeMs.toFixed(2)}ms total, ${p.avgTimeMs.toFixed(2)}ms avg, ${p.maxTimeMs.toFixed(2)}ms max`);
    }
    console.log('==================================\n');
  }
}

/**
 * Metrics collector for runtime performance tracking
 */
export class MetricsCollector {
  private metrics: PerformanceMetrics[] = [];
  private config: PerformanceConfig = {
    enableProfiling: false,
    enableMetrics: true,
    metricsRetentionMs: 5 * 60 * 1000, // 5 minutes
    maxMetricsEntries: 10000,
    sampleRate: 1.0,
  };

  configure(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  record(operation: string, durationMs: number, metadata?: Record<string, unknown>): void {
    if (!this.config.enableMetrics) return;
    if (Math.random() > this.config.sampleRate) return;

    const memoryUsed = (performance as any).memory
      ? (performance as any).memory.usedJSHeapSize / 1024 / 1024
      : 0;

    this.metrics.push({
      timestamp: Date.now(),
      operation,
      durationMs,
      memoryUsedMB: memoryUsed,
      metadata,
    });

    // Trim old metrics
    const cutoff = Date.now() - this.config.metricsRetentionMs;
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);

    // Enforce max entries
    if (this.metrics.length > this.config.maxMetricsEntries) {
      this.metrics = this.metrics.slice(-this.config.maxMetricsEntries);
    }
  }

  getMetrics(operation?: string, since?: number): PerformanceMetrics[] {
    let filtered = this.metrics;
    if (operation) {
      filtered = filtered.filter(m => m.operation === operation);
    }
    if (since) {
      filtered = filtered.filter(m => m.timestamp >= since);
    }
    return filtered;
  }

  getStats(operation: string): { count: number; avgMs: number; minMs: number; maxMs: number; p50Ms: number; p95Ms: number; p99Ms: number } | null {
    const ops = this.getMetrics(operation);
    if (ops.length === 0) return null;

    const durations = ops.map(m => m.durationMs).sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);

    return {
      count: durations.length,
      avgMs: sum / durations.length,
      minMs: durations[0],
      maxMs: durations[durations.length - 1],
      p50Ms: durations[Math.floor(durations.length * 0.5)],
      p95Ms: durations[Math.floor(durations.length * 0.95)],
      p99Ms: durations[Math.floor(durations.length * 0.99)],
    };
  }

  clear(): void {
    this.metrics = [];
  }

  getConfig(): PerformanceConfig {
    return { ...this.config };
  }
}

/**
 * LRU Cache with TTL support
 */
export class PerformanceCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 1000, defaultTtlMs: number = 300000) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtlMs;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttlMs ?? this.defaultTtl);
    const size = this.estimateSize(value);

    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      expiresAt,
      hits: 0,
      size,
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    entry.hits++;
    this.hits++;
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.hits < lruTime) {
        lruTime = entry.hits;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  private estimateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2; // Rough estimate
    } catch {
      return 100;
    }
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: number; memoryEstimateKB: number } {
    let memoryEstimate = 0;
    for (const entry of this.cache.values()) {
      memoryEstimate += entry.size;
    }
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      memoryEstimateKB: memoryEstimate / 1024,
    };
  }
}

/**
 * Speculative fetcher for pre-loading likely-needed data
 */
export class SpeculativeFetcher<T> {
  private cache: PerformanceCache<T>;
  private fetchFn: (key: string) => Promise<T>;
  private accessPatterns: Map<string, Map<string, number>> = new Map();
  private pendingFetches: Set<string> = new Set();

  constructor(fetchFn: (key: string) => Promise<T>, cacheOptions?: { maxSize?: number; defaultTtlMs?: number }) {
    this.fetchFn = fetchFn;
    this.cache = new PerformanceCache<T>(cacheOptions?.maxSize ?? 100, cacheOptions?.defaultTtlMs ?? 300000);
  }

  async get(key: string): Promise<T> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Check if already fetching
    if (this.pendingFetches.has(key)) {
      // Wait for existing fetch
      while (this.pendingFetches.has(key)) {
        await new Promise(r => setTimeout(r, 10));
      }
      const cached = this.cache.get(key);
      if (cached) return cached;
    }

    // Fetch fresh
    this.pendingFetches.add(key);
    try {
      const result = await this.fetchFn(key);
      this.cache.set(key, result);
      return result;
    } finally {
      this.pendingFetches.delete(key);
    }
  }

  recordAccess(fromKey: string, toKey: string): void {
    const patterns = this.accessPatterns.get(fromKey) || new Map();
    patterns.set(toKey, (patterns.get(toKey) || 0) + 1);
    this.accessPatterns.set(fromKey, patterns);
  }

  async prefetchLikely(currentKey: string, maxPrefetch: number = 3): Promise<void> {
    const patterns = this.accessPatterns.get(currentKey);
    if (!patterns) return;

    const sorted = Array.from(patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxPrefetch)
      .map(([key]) => key);

    for (const key of sorted) {
      if (!this.cache.has(key) && !this.pendingFetches.has(key)) {
        // Fire and forget
        this.fetchFn(key).then(result => {
          this.cache.set(key, result);
          this.pendingFetches.delete(key);
        }).catch(() => {
          this.pendingFetches.delete(key);
        });
      }
    }
  }

  getStats(): { cacheStats: ReturnType<PerformanceCache<T>['getStats']>; pendingFetches: number } {
    return {
      cacheStats: this.cache.getStats(),
      pendingFetches: this.pendingFetches.size,
    };
  }
}

/**
 * Connection pool manager for HTTP keep-alive optimization (Browser version)
 */
export class ConnectionPoolManager {
  private static instance: ConnectionPoolManager | null = null;

  private constructor() {}

  static getInstance(): ConnectionPoolManager {
    if (!ConnectionPoolManager.instance) {
      ConnectionPoolManager.instance = new ConnectionPoolManager();
    }
    return ConnectionPoolManager.instance;
  }

  /**
   * Fetch with connection pooling for keep-alive optimization
   * Prioritizes high-priority requests (chat streaming) over normal requests
   */
  async fetchWithPool<T = unknown>(
    url: string,
    options: RequestInit & { priority?: 'high' | 'normal' | 'low' } = {}
  ): Promise<Response> {
    const { priority = 'normal', ...fetchOptions } = options;

    // In browser environment, we use native fetch with keepalive
    // The connection pooling is handled by the browser's HTTP/2 connection reuse
    const response = await fetch(url, {
      ...fetchOptions,
      // Enable keep-alive for connection reuse
      keepalive: true,
      // Priority hint for browser scheduling
      priority: priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'auto',
    } as RequestInit);

    return response;
  }

  getStats(): { pools: number; totalInUse: number } {
    return { pools: 0, totalInUse: 0 }; // Browser handles pooling natively
  }
}

/**
 * Debounced function executor with cancellation
 */
export class DebouncedExecutor {
  private timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingPromises: Map<string, Promise<unknown>> = new Map();

  debounce<T>(key: string, fn: () => Promise<T>, delayMs: number): Promise<T> {
    // Cancel existing
    const existingTimeout = this.timeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const existingPromise = this.pendingPromises.get(key);
    if (existingPromise) {
      // Return existing promise if it's still pending
      return existingPromise as Promise<T>;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this.timeouts.delete(key);
        this.pendingPromises.delete(key);
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delayMs);

      this.timeouts.set(key, timeout);
    });
  }

  cancel(key: string): boolean {
    const timeout = this.timeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(key);
      this.pendingPromises.delete(key);
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.pendingPromises.clear();
  }

  isPending(key: string): boolean {
    return this.timeouts.has(key);
  }
}

/**
 * Memory-efficient object pool for reusable objects
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  private maxSize: number;
  private created = 0;
  private reused = 0;

  constructor(createFn: () => T, resetFn: (obj: T) => void, maxSize: number = 100) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      const obj = this.pool.pop()!;
      this.reused++;
      return obj;
    }
    this.created++;
    return this.createFn();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
    // If pool is full, let GC handle it
  }

  getStats(): { poolSize: number; created: number; reused: number; reuseRate: number } {
    const total = this.created + this.reused;
    return {
      poolSize: this.pool.length,
      created: this.created,
      reused: this.reused,
      reuseRate: total > 0 ? this.reused / total : 0,
    };
  }

  clear(): void {
    this.pool = [];
    this.created = 0;
    this.reused = 0;
  }
}

/**
 * Global performance utilities instance
 */
export const performanceUtils = {
  benchmark: new BenchmarkRunner(),
  profiler: new Profiler(),
  metrics: new MetricsCollector(),
  connectionPool: ConnectionPoolManager.getInstance(),
  debounced: new DebouncedExecutor(),
};

/**
 * Decorator for automatic performance tracking
 */
export function trackPerformance(operationName?: string) {
  return function (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
    const originalMethod = descriptor.value;
    const name = operationName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      const timer = new HighResTimer();
      timer.start();
      try {
        const result = await originalMethod.apply(this, args);
        performanceUtils.metrics.record(name, timer.stop(), { success: true });
        return result;
      } catch (error) {
        performanceUtils.metrics.record(name, timer.stop(), { success: false, error: String(error) });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Async wrapper for performance tracking
 */
export async function withPerformanceTracking<T>(
  operationName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const timer = new HighResTimer();
  timer.start();
  try {
    const result = await fn();
    performanceUtils.metrics.record(operationName, timer.stop(), { ...metadata, success: true });
    return result;
  } catch (error) {
    performanceUtils.metrics.record(operationName, timer.stop(), { ...metadata, success: false, error: String(error) });
    throw error;
  }
}

/**
 * Synchronous wrapper for performance tracking
 */
export function withPerformanceTrackingSync<T>(
  operationName: string,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const timer = new HighResTimer();
  timer.start();
  try {
    const result = fn();
    performanceUtils.metrics.record(operationName, timer.stop(), { ...metadata, success: true });
    return result;
  } catch (error) {
    performanceUtils.metrics.record(operationName, timer.stop(), { ...metadata, success: false, error: String(error) });
    throw error;
  }
}

/**
 * Memory pressure monitor (simplified for browser)
 */
export class MemoryPressureMonitor {
  private thresholds = {
    warning: 0.7,  // 70% heap used
    critical: 0.85, // 85% heap used
    emergency: 0.95, // 95% heap used
  };

  private callbacks: Map<string, (level: 'warning' | 'critical' | 'emergency', usage: number) => void> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private checkIntervalMs = 5000;

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.check();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private check(): void {
    const memory = (performance as any).memory;
    if (!memory) return;

    const heapUsedRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

    let level: 'warning' | 'critical' | 'emergency' | null = null;
    if (heapUsedRatio >= this.thresholds.emergency) {
      level = 'emergency';
    } else if (heapUsedRatio >= this.thresholds.critical) {
      level = 'critical';
    } else if (heapUsedRatio >= this.thresholds.warning) {
      level = 'warning';
    }

    if (level) {
      for (const callback of this.callbacks.values()) {
        try {
          callback(level, heapUsedRatio);
        } catch {
          // Ignore callback errors
        }
      }
    }
  }

  onPressure(callback: (level: 'warning' | 'critical' | 'emergency', usage: number) => void): string {
    const id = Math.random().toString(36).substring(7);
    this.callbacks.set(id, callback);
    return id;
  }

  offPressure(id: string): void {
    this.callbacks.delete(id);
  }

  setThresholds(thresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  getCurrentUsage(): { heapUsed: number; heapTotal: number; ratio: number; external: number } {
    const memory = (performance as any).memory;
    if (!memory) {
      return { heapUsed: 0, heapTotal: 0, ratio: 0, external: 0 };
    }
    return {
      heapUsed: memory.usedJSHeapSize,
      heapTotal: memory.jsHeapSizeLimit,
      ratio: memory.usedJSHeapSize / memory.jsHeapSizeLimit,
      external: 0,
    };
  }
}

export const memoryPressureMonitor = new MemoryPressureMonitor();

/**
 * Startup performance tracker
 */
export class StartupTracker {
  private marks: Map<string, number> = new Map();
  private measures: Map<string, { start: string; end: string; duration: number }> = new Map();

  mark(name: string): void {
    this.marks.set(name, Date.now());
  }

  measure(name: string, startMark: string, endMark?: string): number {
    const startTime = this.marks.get(startMark);
    if (!startTime) {
      throw new Error(`Start mark "${startMark}" not found`);
    }

    const endTime = endMark ? this.marks.get(endMark) : Date.now();
    if (endMark && !endTime) {
      throw new Error(`End mark "${endMark}" not found`);
    }

    const duration = (endTime || Date.now()) - startTime;
    this.measures.set(name, { start: startMark, end: endMark || 'now', duration });
    return duration;
  }

  getMeasure(name: string): { start: string; end: string; duration: number } | undefined {
    return this.measures.get(name);
  }

  getAllMeasures(): Map<string, { start: string; end: string; duration: number }> {
    return new Map(this.measures);
  }

  printReport(): void {
    console.log('\n=== Startup Performance Report ===');
    for (const [name, measure] of this.measures) {
      console.log(`${name}: ${measure.duration}ms (${measure.start} → ${measure.end})`);
    }
    console.log('==================================\n');
  }
}

export const startupTracker = new StartupTracker();