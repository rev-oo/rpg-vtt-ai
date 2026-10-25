export interface RateLimitOptions {
  /** Attempts allowed per window. */
  max: number;
  windowMs: number;
  now?: () => number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Counts attempts per key in fixed windows. In memory, which matches the single-process
 * topology (specs §4.2).
 */
export class RateLimit {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #windows = new Map<string, Window>();

  constructor({ max, windowMs, now = Date.now }: RateLimitOptions) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /** Milliseconds until `key` may try again, or 0 if the attempt may proceed. */
  retryAfterMs(key: string): number {
    const now = this.#now();
    const window = this.#current(key, now);
    return window && window.count >= this.#max ? window.resetAt - now : 0;
  }

  record(key: string): void {
    const now = this.#now();
    this.#sweep(now);
    const window = this.#current(key, now) ?? { count: 0, resetAt: now + this.#windowMs };
    window.count += 1;
    this.#windows.set(key, window);
  }

  clear(key: string): void {
    this.#windows.delete(key);
  }

  #current(key: string, now: number): Window | undefined {
    const window = this.#windows.get(key);
    return window && window.resetAt > now ? window : undefined;
  }

  /** Drops expired windows so the map cannot grow without bound. */
  #sweep(now: number): void {
    if (this.#windows.size < 1000) return;
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(key);
    }
  }
}
