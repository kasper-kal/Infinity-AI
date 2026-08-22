import { Request, Response, NextFunction } from "express";

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * In-memory token bucket rate limiter
 * Key format: "ip:endpoint" or "ip:authenticated:accountId:endpoint"
 */
const buckets = new Map<string, RateLimitBucket>();

/**
 * Cleanup old buckets periodically (older than 1 hour)
 */
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > oneHour) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Create a rate limiter middleware with token bucket algorithm
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyGenerator, skipSuccessfulRequests, skipFailedRequests } = config;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Generate rate limit key
    const key = keyGenerator ? keyGenerator(req) : defaultKeyGenerator(req);
    const now = Date.now();

    // Get or create bucket
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: maxRequests, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refillRate = maxRequests / windowMs; // tokens per ms
    bucket.tokens = Math.min(maxRequests, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    // Check if request can proceed
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", Math.floor(bucket.tokens));
      res.setHeader("X-RateLimit-Reset", Math.ceil((bucket.lastRefill + windowMs) / 1000));

      // Track if we should skip based on response status
      if (skipSuccessfulRequests || skipFailedRequests) {
        const originalSend = res.send;
        res.send = function (body?: any): Response {
          const shouldSkip =
            (skipSuccessfulRequests && res.statusCode < 400) ||
            (skipFailedRequests && res.statusCode >= 400);

          if (shouldSkip) {
            // Refund the token
            bucket!.tokens = Math.min(maxRequests, bucket!.tokens + 1);
            res.setHeader("X-RateLimit-Remaining", Math.floor(bucket!.tokens));
          }
          return originalSend.call(this, body);
        };
      }

      next();
    } else {
      // Rate limited - calculate retry-after
      const tokensNeeded = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(tokensNeeded / refillRate);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil((now + retryAfterMs) / 1000));
      res.setHeader("Retry-After", retryAfterSeconds);

      res.status(429).json({
        success: false,
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
        retryAfter: retryAfterSeconds,
      });
    }
  };
}

/**
 * Default key generator: IP + route path
 */
function defaultKeyGenerator(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const path = req.path;
  return `${ip}:${path}`;
}

/**
 * Authenticated key generator: IP + accountId + route path
 * Used for authenticated endpoints where limits are per-account
 */
export function authenticatedKeyGenerator(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const path = req.path;
  const accountId = (req as any).accountId || "anonymous";
  return `${ip}:auth:${accountId}:${path}`;
}

/**
 * Pre-configured rate limiters for auth endpoints
 */

// Login: 5 requests per minute per IP
export const loginRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: defaultKeyGenerator,
});

// Register: 3 requests per minute per IP
export const registerRateLimiter = createRateLimiter({
  maxRequests: 3,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: defaultKeyGenerator,
});

// Password change/reset: 3 requests per hour per IP
export const passwordRateLimiter = createRateLimiter({
  maxRequests: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyGenerator: defaultKeyGenerator,
});

// Authenticated endpoints (me): 60 requests per minute per IP+account
export const authMeRateLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: authenticatedKeyGenerator,
});

// Generic strict limiter for sensitive endpoints
export const strictRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: defaultKeyGenerator,
});

/**
 * Clear rate limit bucket for a key (e.g., on successful auth)
 */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Get current rate limit status for a key (for debugging/monitoring)
 */
export function getRateLimitStatus(key: string): { remaining: number; resetAt: number } | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;

  return {
    remaining: Math.floor(bucket.tokens),
    resetAt: bucket.lastRefill + 60 * 1000, // approximate
  };
}