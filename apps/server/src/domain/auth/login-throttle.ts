export interface ThrottleLimit {
  /** Failed attempts allowed per window. */
  max: number;
  windowMs: number;
}

export interface LoginThrottleOptions {
  perIp?: ThrottleLimit;
  perUsername?: ThrottleLimit;
  now?: () => number;
}

interface Window {
  failures: number;
  resetAt: number;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Counts failed logins per IP and per username in fixed windows (FR-AUTH-07). In memory, which
 * matches the single-process topology (specs §4.2).
 */
export class LoginThrottle {
  readonly #limits: { ip: ThrottleLimit; username: ThrottleLimit };
  readonly #now: () => number;
  readonly #windows = new Map<string, Window>();

  constructor({
    perIp = { max: 20, windowMs: FIFTEEN_MINUTES },
    perUsername = { max: 5, windowMs: FIFTEEN_MINUTES },
    now = Date.now,
  }: LoginThrottleOptions = {}) {
    this.#limits = { ip: perIp, username: perUsername };
    this.#now = now;
  }

  /** Milliseconds until another attempt is allowed, or 0 if the attempt may proceed. */
  retryAfterMs(ip: string, username: string): number {
    const now = this.#now();
    let wait = 0;
    for (const [key, limit] of this.#keys(ip, username)) {
      const window = this.#current(key, now);
      if (window && window.failures >= limit.max) wait = Math.max(wait, window.resetAt - now);
    }
    return wait;
  }

  recordFailure(ip: string, username: string): void {
    const now = this.#now();
    this.#sweep(now);
    for (const [key, limit] of this.#keys(ip, username)) {
      const window = this.#current(key, now) ?? { failures: 0, resetAt: now + limit.windowMs };
      window.failures += 1;
      this.#windows.set(key, window);
    }
  }

  /** A successful login clears the username's failures (the IP's are kept). */
  recordSuccess(username: string): void {
    this.#windows.delete(this.#usernameKey(username));
  }

  #keys(ip: string, username: string): [string, ThrottleLimit][] {
    return [
      [`ip:${ip}`, this.#limits.ip],
      [this.#usernameKey(username), this.#limits.username],
    ];
  }

  #usernameKey(username: string): string {
    return `user:${username.toLowerCase()}`;
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
