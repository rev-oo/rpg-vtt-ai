/**
 * The source of randomness for rolls (FR-DICE-05). The server passes a cryptographically
 * secure one (FR-CHAT-04); tests and replays pass `seededRng`.
 */
export interface Rng {
  /** A uniformly random integer in [0, n), for 1 <= n <= 2^32. */
  nextInt(n: number): number;
}

const TWO_32 = 2 ** 32;

/** FNV-1a, to turn a text seed into 32 bits. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A deterministic RNG (mulberry32): the same seed always gives the same rolls. Not
 * cryptographically secure; use it only for tests and replay.
 */
export function seededRng(seed: number | string): Rng {
  let state = typeof seed === 'number' ? seed >>> 0 : hash(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    nextInt(n) {
      // Rejection sampling keeps every result equally likely.
      const limit = TWO_32 - (TWO_32 % n);
      let value = next();
      while (value >= limit) value = next();
      return value % n;
    },
  };
}
