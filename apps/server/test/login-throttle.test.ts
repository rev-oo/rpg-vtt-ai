import { describe, expect, it } from 'vitest';

import { LoginThrottle } from '../src/domain/auth/login-throttle.js';

function setup() {
  let now = 0;
  const throttle = new LoginThrottle({
    perIp: { max: 4, windowMs: 1000 },
    perUsername: { max: 2, windowMs: 1000 },
    now: () => now,
  });
  return {
    throttle,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('LoginThrottle', () => {
  it('blocks a username after its failure limit, until the window ends', () => {
    const { throttle, advance } = setup();
    throttle.recordFailure('1.1.1.1', 'alice');
    expect(throttle.retryAfterMs('1.1.1.1', 'alice')).toBe(0);
    throttle.recordFailure('2.2.2.2', 'Alice');

    expect(throttle.retryAfterMs('3.3.3.3', 'ALICE')).toBe(1000);
    expect(throttle.retryAfterMs('3.3.3.3', 'bob')).toBe(0);
    advance(1000);
    expect(throttle.retryAfterMs('3.3.3.3', 'alice')).toBe(0);
  });

  it('blocks an IP across usernames after its failure limit', () => {
    const { throttle, advance } = setup();
    for (const name of ['a', 'b', 'c', 'd']) throttle.recordFailure('1.1.1.1', name);

    advance(400);
    expect(throttle.retryAfterMs('1.1.1.1', 'fresh')).toBe(600);
    expect(throttle.retryAfterMs('9.9.9.9', 'fresh')).toBe(0);
  });

  it('clears a username on success but keeps the IP count', () => {
    const { throttle } = setup();
    throttle.recordFailure('1.1.1.1', 'alice');
    throttle.recordFailure('1.1.1.1', 'alice');
    throttle.recordSuccess('alice');
    expect(throttle.retryAfterMs('9.9.9.9', 'alice')).toBe(0);

    throttle.recordFailure('1.1.1.1', 'x');
    throttle.recordFailure('1.1.1.1', 'y');
    expect(throttle.retryAfterMs('1.1.1.1', 'z')).toBeGreaterThan(0);
  });
});
