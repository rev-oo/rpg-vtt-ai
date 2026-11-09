// Which dice to throw for a chat message's rolls, from the dice and results the server decided.

import type { TableEvent } from '@vtt/sdk/client';

import type { Sides } from './shapes.js';

/** The SDK exports no message or roll types, so they come from its event type. */
export type ChatMessage = Extract<TableEvent, { type: 'chat.message' }>['message'];

/** How a die prints its labels. */
export type Print = 'plain' | 'tens' | 'units';

export interface ThrownDie {
  sides: Sides;
  /** The label that must land up: the value, or 0–9 on d10s, whose 10 prints as 0. */
  label: number;
  print: Print;
  /** Dropped, rerolled or otherwise not counted toward the total. */
  dim: boolean;
}

/** More dice than this in one message are left to the chat. */
export const MAX_DICE = 30;

const STANDARD: ReadonlySet<number> = new Set([4, 6, 8, 12, 20]);

/** The text a label prints as. Sixes and nines get a dot so they read either way up. */
export function printLabel(label: number, print: Print, sides: Sides): string {
  if (print === 'tens') return label === 0 ? '00' : `${String(label)}0`;
  const text = String(label);
  return sides >= 8 && (label === 6 || label === 9) ? `${text}.` : text;
}

/**
 * The dice of a message's rolls, in order. d4–d20 throw one die per result; d10 prints 10 as 0;
 * d100 throws a tens and a units d10 (100 shows as 00 and 0). Other dice (custom dice, d3, d7…)
 * have no shape here and are skipped. Returns null when there is nothing, or too much, to throw.
 */
export function diceOf(rolls: ChatMessage['rolls']): ThrownDie[] | null {
  const dice: ThrownDie[] = [];
  for (const roll of rolls) {
    for (const term of roll.dice) {
      const sides = /^d(\d+)$/.exec(term.die)?.[1];
      const count = sides === undefined ? NaN : Number(sides);
      for (const result of term.results) {
        const dim = !result.active;
        if (STANDARD.has(count)) {
          dice.push({ sides: count as Sides, label: result.value, print: 'plain', dim });
        } else if (count === 10) {
          dice.push({ sides: 10, label: result.value % 10, print: 'plain', dim });
        } else if (count === 100) {
          const value = result.value % 100;
          dice.push({ sides: 10, label: Math.floor(value / 10), print: 'tens', dim });
          dice.push({ sides: 10, label: value % 10, print: 'units', dim });
        }
      }
    }
  }
  return dice.length === 0 || dice.length > MAX_DICE ? null : dice;
}
