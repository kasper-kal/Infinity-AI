/**
 * Performance Benchmarking & Profiling Library
 * Phase 31: Cursor-Level Performance & Polish
 *
 * Provides benchmarking utilities, performance monitoring, and profiling
 * for optimizing Infinity to match Cursor's speed and reliability.
 */

import { performance as nodePerf } from 'perf_hooks';

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
 * High-resolution timer utility
 */
export class HighResTimer {
  private startTime: bigint = 0;
  private endTime: bigint = 0;
  private running = false;

  start(): void {
    this.startTime = nodePerf.now();
    this.running = true;
  }

  stop(): number {
    if (!this.running) {
      return 0;
    }
    this.endTime = nodePerf.now();
    this.running = false;
    return Number(this.endTime - this.startTime);
  }

  getElapsed(): number {
    if (this.running) {
      return Number(nodePerf.now() - this.startTime);
    }
    return Number(this.endTime - this.startTime);
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

  printResults(): void {
    console.log('\n=== Benchmark Results ===');
    for (const [name, result] of this.results) {
      console.log(`${name}:`);
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Avg: ${result.avgMs.toFixed(2)}ms (${result.opsPerSec.toFixed(2)} ops/sec)`);
      console.log(`  Min: ${result.minMs.toFixed(2)}ms | Max: ${result.maxMs.toFixed(2)}ms`);
      console.log(`  P50: ${result.p50Ms.toFixed(2)}ms | P95: ${result.p95Ms.toFixed(2)}ms | P99: ${result.p99Ms.toFixed(2)}ms`);
    }
    console.log('=========================\n');
  }
}

/**
 * Profiler for measuring function execution times
 */
export class Profiler {
  private profiles: Map<string, ProfileResult> = new Map();
  private activeCalls: Map<string, { start: number; parent?: string }> = new Map();
  private callStack: string[] = [];
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

    const start = nodePerf.now();
    const parent = this.callStack[this.callStack.length - 1];
    this.activeCalls.set(functionName, { start, parent });
    this.callStack.push(functionName);
  }

  exit(functionName: string): void {
    if (!this.enabled) return;

    const call = this.activeCalls.get(functionName);
    if (!call) return;

    const duration = nodePerf.now() - call.start;
    this.activeCalls.delete(functionName);
    this.callStack.pop();

    const existing = this.profiles.get(functionName);
    if (existing) {
      existing.callCount++;
      existing.totalTimeMs += duration;
      existing.avgTimeMs = existing.totalTimeMs / existing.callCount;
      existing.maxTimeMs = Math.max(existing.maxTimeMs, duration);
      // Self time = total time - time spent in children
      // For simplicity, we track total time here
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

  getProfile(functionName: string): ProfileResult | undefined {
    return this.profiles.get(functionName);
  }

  getAllProfiles(): ProfileResult[] {
    return Array.from(this.profiles.values())
      .sort((a, b) => b.totalTimeMs - a.totalTimeMs);
  }

  clear(): void {
    this.profiles.clear();
    this.activeCalls.clear();
    this.callStack = [];
  }

  printProfiles(topN: number = 20): void {
    console.log('\n=== Profiler Results (Top ' + topN + ') ===');
    const profiles = this.getAllProfiles().slice(0, topN);
    for (const profile of profiles) {
      console.log(`${profile.functionName}:`);
      console.log(`  Calls: ${profile.callCount} | Total: ${profile.totalTimeMs.toFixed(2)}ms`);
      console.log(`  Avg: ${profile.avgTimeMs.toFixed(2)}ms | Max: ${profile.maxTimeMs.toFixed(2)}ms`);
    }
    console.log('========================================\n');
  }
}

/**
 * Performance metrics collector
 */
export class MetricsCollector {
  private metrics: PerformanceMetrics[] = [];
  private config: PerformanceConfig;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enableProfiling: true,
      enableMetrics: true,
      metricsRetentionMs: 5 * 60 * 1000, // 5 minutes
      maxMetricsEntries: 10000,
      sampleRate: 1.0,
      ...config,
    };
  }

  record(operation: string, durationMs: number, metadata?: Record<string, unknown>): void {
    if (!this.config.enableMetrics) return;
    if (Math.random() > this.config.sampleRate) return;

    const memoryUsed = process.memoryUsage().heapUsed / 1024 / 1024;

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

    // Trim to max entries
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
      filtered = filtered.filter(m => m.timestamp > since);
    }
    return filtered;
  }

  getAggregates(operation: string): {
    count: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    avgMemoryMB: number;
  } | null {
    const ops = this.getMetrics(operation);
    if (ops.length === 0) return null;

    const durations = ops.map(m => m.durationMs).sort((a, b) => a - b);
    const memories = ops.map(m => m.memoryUsedMB);

    const total = durations.reduce((a, b) => a + b, 0);
    const avg = total / durations.length;
    const min = durations[0];
    const max = durations[durations.length - 1];
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];
    const avgMemory = memories.reduce((a, b) => a + b, 0) / memories.length;

    return {
      count: ops.length,
      avgMs: avg,
      minMs,
      maxMs,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      avgMemoryMB: avgMemory,
    };
  }

  clear(): void {
    this.metrics = [];
  }

  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * LRU Cache with TTL and size tracking
 */
export class PerformanceCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private defaultTtl: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 1000, defaultTtlMs: number = 60000) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtlMs;
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

  set(key: string, value: T, ttlMs?: number): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const size = this.estimateSize(value);
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtl),
      hits: 0,
      size,
    });
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
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.hits < oldestTime) {
        oldestTime = entry.hits;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 100; // Default estimate
    }
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: number; totalSize: number } {
    const totalSize = Array.from(this.cache.values()).reduce((sum, e) => sum + e.size, 0);
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalSize,
    };
  }

  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * Speculative fetcher for pre-loading likely next requests
 */
export class SpeculativeFetcher<T> {
  private fetchFn: (key: string) => Promise<T>;
  private cache: PerformanceCache<T>;
  private pendingFetches: Map<string, Promise<T>> = new Map();
  private accessPatterns: Map<string, Map<string, number>> = new Map(); // key -> nextKey -> count

  constructor(fetchFn: (key: string) => Promise<T>, cache: PerformanceCache<T>) {
    this.fetchFn = fetchFn;
    this.cache = cache;
  }

  async get(key: string): Promise<T> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Check if already fetching
    const pending = this.pendingFetches.get(key);
    if (pending) {
      return pending;
    }

    // Fetch and cache
    const promise = this.fetchFn(key).then(result => {
      this.cache.set(key, result);
      this.pendingFetches.delete(key);
      return result;
    });

    this.pendingFetches.set(key, promise);
    return promise;
  }

  recordAccess(currentKey: string, nextKey: string): void {
    const patterns = this.accessPatterns.get(currentKey) || new Map();
    patterns.set(nextKey, (patterns.get(nextKey) || 0) + 1);
    this.accessPatterns.set(currentKey, patterns);
  }

  async prefetchLikely(currentKey: string, maxPrefetch: number = 3): Promise<void> {
    const patterns = this.accessPatterns.get(currentKey);
    if (!patterns) return;

    const sorted = Array.from(patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxPrefetch)
      .map(([key]) => key);

    for (const key of sorted) {
      if (!this.cache.get(key) && !this.pendingFetches.has(key)) {
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
 * Connection pool manager for HTTP keep-alive optimization
 */
export class ConnectionPoolManager {
  private pools: Map<string, { agent: unknown; createdAt: number; inUse: number }> = new Map();
  private maxIdleTime: number;
  private maxPoolSize: number;

  constructor(maxIdleTimeMs: number = 30000, maxPoolSize: number = 10) {
    this.maxIdleTime = maxIdleTimeMs;
    this.maxPoolSize = maxPoolSize;
  }

  getPool(key: string): unknown | null {
    const pool = this.pools.get(key);
    if (!pool) return null;

    // Check if pool is stale
    if (Date.now() - pool.createdAt > this.maxIdleTime) {
      this.destroyPool(key);
      return null;
    }

    pool.inUse++;
    return pool.agent;
  }

  setPool(key: string, agent: unknown): void {
    if (this.pools.size >= this.maxPoolSize) {
      this.evictOldestPool();
    }

    this.pools.set(key, {
      agent,
      createdAt: Date.now(),
      inUse: 1,
    });
  }

  releasePool(key: string): void {
    const pool = this.pools.get(key);
    if (pool) {
      pool.inUse = Math.max(0, pool.inUse - 1);
    }
  }

  private evictOldestPool(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, pool] of this.pools) {
      if (pool.inUse === 0 && pool.createdAt < oldestTime) {
        oldestTime = pool.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.destroyPool(oldestKey);
    }
  }

  private destroyPool(key: string): void {
    const pool = this.pools.get(key);
    if (pool && typeof pool.agent === 'object' && pool.agent !== null && 'destroy' in pool.agent) {
      try {
        (pool.agent as { destroy: () => void }).destroy();
      } catch {
        // Ignore destruction errors
      }
    }
    this.pools.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, pool] of this.pools) {
      if (pool.inUse === 0 && now - pool.createdAt > this.maxIdleTime) {
        this.destroyPool(key);
      }
    }
  }

  getStats(): { pools: number; totalInUse: number } {
    let totalInUse = 0;
    for (const pool of this.pools.values()) {
      totalInUse += pool.inUse;
    }
    return {
      pools: this.pools.size,
      totalInUse,
    };
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
    const poolKey = `fetch:${new URL(url, window.location?.origin || 'http://localhost').origin}`;

    // For high priority, we might want to use a dedicated connection
    const effectiveKey = priority === 'high' ? `${poolKey}:high` : poolKey;

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
}

/**
 * Debounced function executor with cancellation
 */
export class DebouncedExecutor {
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
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
  connectionPool: new ConnectionPoolManager(),
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
 * Memory pressure monitor
 */
export class MemoryPressureMonitor {
  private thresholds = {
    warning: 0.7,  // 70% heap used
    critical: 0.85, // 85% heap used
    emergency: 0.95, // 95% heap used
  };

  private callbacks: Map<string, (level: 'warning' | 'critical' | 'emergency', usage: number) => void> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
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
    const usage = process.memoryUsage();
    const heapUsedRatio = usage.heapUsed / usage.heapTotal;

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
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      ratio: usage.heapUsed / usage.heapTotal,
      external: usage.external,
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