// What to throw for a chat message: one die per result the server rolled, on the face it chose.

import type { ShapeName } from './shapes.js';

/** The parts of a chat message this module reads (`@vtt/shared`'s ChatMessage). */
export interface RolledMessage {
  id: string;
  senderId: string | null;
  rolls: readonly {
    dice: readonly {
      die: string;
      results: readonly { value: number; active: boolean }[];
    }[];
  }[];
}

export interface DieToThrow {
  shape: ShapeName;
  /** The labels on the die's faces (or a d4's vertices), in order. */
  labels: readonly string[];
  /** The index in `labels` that must land up. */
  result: number;
  /** Dropped and rerolled dice land too, dimmed. */
  active: boolean;
}

export interface Throw {
  dice: DieToThrow[];
  /** The results thrown, as `d20:14`, one per result (a d100 is two dice). */
  results: string[];
  /** Results with no 3D die: other sizes, custom dice, or past the limit. */
  skipped: number;
  /** From the message id: viewers with the same window size see the same tumble. */
  seed: number;
}

/** More dice than this in one message are left out; the chat shows them all. */
export const MAX_DICE = 30;

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

const LABELS: Readonly<Record<ShapeName, readonly string[]>> = {
  d4: range(1, 4),
  d6: range(1, 6),
  d8: range(1, 8),
  // A d10 shows 0 for 10.
  d10: range(0, 9),
  d12: range(1, 12),
  d20: range(1, 20),
};
const TENS = range(0, 9).map((digit) => `${digit}0`);

const STANDARD: Readonly<Record<string, ShapeName>> = {
  d4: 'd4',
  d6: 'd6',
  d8: 'd8',
  d10: 'd10',
  d12: 'd12',
  d20: 'd20',
};

/** The 3D dice for one result, or null if no die shows it. */
export function diceFor(die: string, value: number, active: boolean): DieToThrow[] | null {
  if (!Number.isInteger(value)) return null;
  if (die === 'd100') {
    if (value < 1 || value > 100) return null;
    // Two d10s: tens (00–90) and units (0–9); 100 shows 00 and 0.
    const tens = Math.floor((value % 100) / 10);
    return [
      { shape: 'd10', labels: TENS, result: tens, active },
      { shape: 'd10', labels: LABELS.d10, result: value % 10, active },
    ];
  }
  const shape = STANDARD[die];
  if (!shape) return null;
  const labels = LABELS[shape];
  const result = shape === 'd10' ? value % 10 : value - 1;
  if (value < 1 || result >= labels.length) return null;
  return [{ shape, labels, result, active }];
}

/** A 32-bit FNV-1a hash of `text`. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/** Every die of a message's rolls, in order, up to `MAX_DICE`. */
export function throwFor(message: RolledMessage): Throw {
  const dice: DieToThrow[] = [];
  const results: string[] = [];
  let skipped = 0;
  for (const roll of message.rolls) {
    for (const term of roll.dice) {
      for (const result of term.results) {
        const found = diceFor(term.die, result.value, result.active);
        if (!found || dice.length + found.length > MAX_DICE) skipped += 1;
        else {
          dice.push(...found);
          results.push(`${term.die}:${String(result.value)}`);
        }
      }
    }
  }
  return { dice, results, skipped, seed: seedOf(message.id) };
}

/**
 * The labels after the die landed with face (or vertex) `up` on top: the result's label
 * trades places with the one that landed up, so the die shows the server's result.
 */
export function relabel(labels: readonly string[], up: number, result: number): string[] {
  const next = [...labels];
  const landed = next[up];
  const wanted = next[result];
  if (landed === undefined || wanted === undefined) return next;
  next[up] = wanted;
  next[result] = landed;
  return next;
}
