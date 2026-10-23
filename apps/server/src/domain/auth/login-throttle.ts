import { RateLimit } from './rate-limit.js';

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

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Counts failed logins per IP and per username in fixed windows (FR-AUTH-07). A wrong current
 * password on a password change counts too: it is the same secret.
 */
export class LoginThrottle {
  readonly #ip: RateLimit;
  readonly #username: RateLimit;

  constructor({
    perIp = { max: 20, windowMs: FIFTEEN_MINUTES },
    perUsername = { max: 5, windowMs: FIFTEEN_MINUTES },
    now = Date.now,
  }: LoginThrottleOptions = {}) {
    this.#ip = new RateLimit({ ...perIp, now });
    this.#username = new RateLimit({ ...perUsername, now });
  }

  /** Milliseconds until another attempt is allowed, or 0 if the attempt may proceed. */
  retryAfterMs(ip: string, username: string): number {
    return Math.max(this.#ip.retryAfterMs(ip), this.#username.retryAfterMs(usernameKey(username)));
  }

  recordFailure(ip: string, username: string): void {
    this.#ip.record(ip);
    this.#username.record(usernameKey(username));
  }

  /** A successful login clears the username's failures (the IP's are kept). */
  recordSuccess(username: string): void {
    this.#username.clear(usernameKey(username));
  }
}

function usernameKey(username: string): string {
  return username.toLowerCase();
}
