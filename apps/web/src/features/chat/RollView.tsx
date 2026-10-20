import type { ReactElement } from 'react';

import type { DieResult, Roll } from '@vtt/shared/api';

import { t } from '../../i18n/index.js';

const FLAGS = ['rerolled', 'exploded', 'dropped', 'success', 'failure'] as const;

/** How one die reads: its face, struck through when it does not count. */
function Die({ die }: { die: DieResult }): ReactElement {
  const flags = FLAGS.filter((flag) => die[flag]);
  const tone = die.success
    ? 'border-primary font-bold'
    : die.failure
      ? 'border-danger bg-danger-soft'
      : 'border-line';
  const description = [String(die.value), ...flags.map((flag) => t(`chat.die.${flag}`))].join(', ');
  return (
    <li
      className={`min-w-7 rounded border px-1 text-center font-mono ${tone} ${die.active ? '' : 'text-muted line-through'}`}
      title={description}
    >
      <span aria-hidden="true">
        {die.label ?? die.value}
        {die.exploded && '!'}
      </span>
      <span className="sr-only">{description}</span>
    </li>
  );
}

/** A roll in the chat: what was rolled, every die and the total (FR-DICE-04). */
export function RollView({ roll }: { roll: Roll }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-sm break-words">
        {roll.expression}
        {roll.resolved !== roll.expression && (
          <span className="text-muted"> → {roll.resolved}</span>
        )}
      </p>
      {roll.dice.map((term, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1 text-sm">
          {/* A lone term already reads in the expression above. */}
          {term.formula !== roll.expression && (
            <span className="font-mono text-muted">{term.formula}</span>
          )}
          <ul
            className="flex flex-wrap gap-1"
            aria-label={t('chat.rollDice', { formula: term.formula })}
          >
            {term.results.map((die, at) => (
              <Die key={at} die={die} />
            ))}
          </ul>
        </div>
      ))}
      <p className="text-2xl font-bold" aria-label={t('chat.rollTotal', { total: roll.total })}>
        {roll.total}
      </p>
    </div>
  );
}
