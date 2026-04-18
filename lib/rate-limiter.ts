/**
 * Token-bucket rate limiter for API calls.
 * Shared across pipeline scripts to prevent rate-limit blocks at scale.
 */

type BucketConfig = {
  /** Max tokens (burst capacity) */
  maxTokens: number;
  /** Tokens added per second */
  refillRate: number;
};

const DEFAULTS: Record<string, BucketConfig> = {
  serpapi:       { maxTokens: 3,  refillRate: 1    }, // ~1 req/sec, burst of 3
  openai:        { maxTokens: 5,  refillRate: 2    }, // ~2 req/sec, burst of 5
  ollama:        { maxTokens: 3,  refillRate: 1    }, // ~1 req/sec, burst of 3
  pubmed:        { maxTokens: 3,  refillRate: 0.33 }, // ~1 req/3sec
  reddit:        { maxTokens: 2,  refillRate: 0.5  }, // ~1 req/2sec
  revalidate:    { maxTokens: 10, refillRate: 5    }, // ~5 req/sec for ISR
  fetch:         { maxTokens: 5,  refillRate: 2    }, // general HTTP fetching
  dataforseo:    { maxTokens: 5,  refillRate: 1    }, // DataForSEO batch API
  ahrefs:        { maxTokens: 3,  refillRate: 0.5  }, // Ahrefs API (conservative)
  youtube:       { maxTokens: 5,  refillRate: 1    }, // YouTube Data API v3
  clinicaltrials:{ maxTokens: 5,  refillRate: 2    }, // ClinicalTrials.gov (public, generous)
  appstore:      { maxTokens: 3,  refillRate: 0.5  }, // App Store / Play Store scraping
};

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly config: BucketConfig;

  constructor(config: BucketConfig) {
    this.config = config;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.config.maxTokens, this.tokens + elapsed * this.config.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.config.refillRate * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= 1;
  }

  /** Check if a token is available without consuming it */
  available(): boolean {
    this.refill();
    return this.tokens >= 1;
  }
}

// Singleton buckets (shared within a Node.js process)
const buckets = new Map<string, TokenBucket>();

function getBucket(name: string): TokenBucket {
  let bucket = buckets.get(name);
  if (!bucket) {
    const config = DEFAULTS[name] ?? { maxTokens: 5, refillRate: 2 };
    bucket = new TokenBucket(config);
    buckets.set(name, bucket);
  }
  return bucket;
}

/**
 * Acquire a rate-limit token before making an API call.
 * Blocks until a token is available.
 *
 * Usage:
 *   await rateLimit('serpapi');
 *   const res = await fetch('https://serpapi.com/...');
 */
export async function rateLimit(apiName: string): Promise<void> {
  const bucket = getBucket(apiName);
  await bucket.acquire();
}

/**
 * Wrap a fetch call with rate limiting.
 *
 * Usage:
 *   const res = await rateLimitedFetch('openai', 'https://api.openai.com/...', { method: 'POST', ... });
 */
export async function rateLimitedFetch(
  apiName: string,
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  await rateLimit(apiName);
  return fetch(url, init);
}
