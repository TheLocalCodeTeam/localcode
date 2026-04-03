// src/rate-limit/index.ts
// Rate limiting to protect users from burning API credits

import { logger } from '../core/logger.js';

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxTokensPerHour: number;
  maxCostPerSession: number;
  cooldownMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequestsPerMinute: 60,
  maxTokensPerHour: 100000,
  maxCostPerSession: 10.0,
  cooldownMs: 1000,
};

export class RateLimiter {
  private requestTimestamps: number[] = [];
  private tokensUsedThisHour = 0;
  private hourStart = Date.now();
  private lastRequestTime = 0;

  constructor(private config: RateLimitConfig = DEFAULT_CONFIG) {}

  /**
   * Check if a request is allowed. Returns true if allowed, false if rate limited.
   */
  canMakeRequest(estimatedTokens: number = 0): { allowed: boolean; reason?: string; retryAfter?: number } {
    const now = Date.now();

    // Check cooldown
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.cooldownMs) {
      const retryAfter = this.config.cooldownMs - timeSinceLastRequest;
      return { allowed: false, reason: 'cooldown', retryAfter };
    }

    // Check requests per minute
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      const oldestRequest = this.requestTimestamps[0];
      const retryAfter = 60000 - (now - oldestRequest);
      return { allowed: false, reason: 'requests_per_minute', retryAfter };
    }

    // Check tokens per hour
    const oneHourAgo = now - 3600000;
    if (this.hourStart < oneHourAgo) {
      this.tokensUsedThisHour = 0;
      this.hourStart = now;
    }
    if (this.tokensUsedThisHour + estimatedTokens > this.config.maxTokensPerHour) {
      const retryAfter = 3600000 - (now - this.hourStart);
      return { allowed: false, reason: 'tokens_per_hour', retryAfter };
    }

    return { allowed: true };
  }

  /**
   * Record a request.
   */
  recordRequest(tokensUsed: number = 0): void {
    this.requestTimestamps.push(Date.now());
    this.lastRequestTime = Date.now();
    this.tokensUsedThisHour += tokensUsed;

    // Reset hour counter if needed
    if (Date.now() - this.hourStart > 3600000) {
      this.tokensUsedThisHour = tokensUsed;
      this.hourStart = Date.now();
    }

    logger.debug('Rate limit: request recorded', {
      requestsThisMinute: this.requestTimestamps.filter(t => t > Date.now() - 60000).length,
      tokensThisHour: this.tokensUsedThisHour,
    });
  }

  /**
   * Check if session cost limit is reached.
   */
  checkCostLimit(currentCost: number): { allowed: boolean; reason?: string } {
    if (currentCost >= this.config.maxCostPerSession) {
      return { allowed: false, reason: `Session cost limit reached ($${currentCost.toFixed(2)} / $${this.config.maxCostPerSession.toFixed(2)})` };
    }
    return { allowed: true };
  }

  /**
   * Get current usage stats.
   */
  getUsageStats(): {
    requestsThisMinute: number;
    tokensThisHour: number;
    hourRemaining: number;
  } {
    const now = Date.now();
    const requestsThisMinute = this.requestTimestamps.filter(t => t > now - 60000).length;
    const tokensThisHour = this.tokensUsedThisHour;
    const hourRemaining = Math.max(0, this.config.maxTokensPerHour - tokensThisHour);

    return { requestsThisMinute, tokensThisHour, hourRemaining };
  }

  /**
   * Reset all counters.
   */
  reset(): void {
    this.requestTimestamps = [];
    this.tokensUsedThisHour = 0;
    this.hourStart = Date.now();
    this.lastRequestTime = 0;
  }
}

export function createRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
  return new RateLimiter({ ...DEFAULT_CONFIG, ...config });
}
