import type { Shape } from './polyhedra.js';

// Which dice to throw for a chat message. The overlay gets the message the server already
// rolled (ADR-077): each die's result is decided, and the throw only shows it.

/** The parts of a chat message this module reads (`ChatMessage` in `@vtt/shared/api`). */
export interface RolledMessage {
  senderId: string | null;
  rolls: readonly {
    dice: readonly {
      die: string;
      results: readonly { value: number; label?: string | undefined; active: boolean }[];
    }[];
  }[];
}

/** One physical die to throw, and the text its top must show. */
export interface Die {
  shape: Shape;
  /** The text on the face (or, for a d4, the corner) that ends up on top. */
  top: string;
  /** The labels of all its faces (corners for a d4), in no particular order. */
  labels: readonly string[];
  /** Dropped or rerolled dice are thrown too, dimmed: they do not count. */
  active: boolean;
}

const STANDARD: Readonly<Record<string, Shape>> = {
  d4: 'd4',
  d6: 'd6',
  d8: 'd8',
  d10: 'd10',
  d12: 'd12',
  d20: 'd20',
};

const range = (count: number, text: (index: number) => string): string[] =>
  Array.from({ length: count }, (_, index) => text(index));

const TENS = range(10, (i) => String(i * 10).padStart(2, '0'));
const UNITS = range(10, String);

/** The physical dice that show one result of a `die` term, or none if this module cannot. */
export function diceFor(die: string, value: number, active: boolean): Die[] {
  if (!Number.isInteger(value)) return [];
  if (die === 'd100') {
    if (value < 1 || value > 100) return [];
    const rest = value % 100;
    return [
      { shape: 'd10', top: TENS[Math.floor(rest / 10)] ?? '00', labels: TENS, active },
      { shape: 'd10', top: UNITS[rest % 10] ?? '0', labels: UNITS, active },
    ];
  }
  const shape = STANDARD[die];
  if (!shape) return [];
  const sides = Number(die.slice(1));
  if (value < 1 || value > sides) return [];
  return [{ shape, top: String(value), labels: range(sides, (i) => String(i + 1)), active }];
}

export interface Choice {
  /** Who views the table. */
  viewerId: string;
  /** Throw for messages others sent too. */
  showOthers: boolean;
  /** The most physical dice in one throw. */
  maxDice: number;
}

/**
 * The dice for a message: every result of every roll, in order, up to `maxDice`. Custom dice
 * (`dF` and the like) and unusual sizes (`d3`, `d7`…) are left out: the module does not know
 * their faces.
 */
export function diceOf(message: RolledMessage, choice: Choice): Die[] {
  if (!choice.showOthers && message.senderId !== choice.viewerId) return [];
  const results = message.rolls.flatMap((roll) =>
    roll.dice.flatMap((term) =>
      term.results.map((result) =>
        result.label === undefined ? diceFor(term.die, result.value, result.active) : [],
      ),
    ),
  );
  // A d100's two dice go together or not at all.
  const dice: Die[] = [];
  for (const group of results) {
    if (dice.length + group.length > choice.maxDice) break;
    dice.push(...group);
  }
  return dice;
}
