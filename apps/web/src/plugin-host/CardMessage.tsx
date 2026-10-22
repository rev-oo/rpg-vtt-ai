import type { ReactElement } from 'react';

import type { ChatMessage, RecipeCard } from '@vtt/shared/api';
import { cn } from '@vtt/ui';

import { RollView } from '../features/chat/RollView.js';

import { PluginBoundary } from './PluginBoundary.js';
import { useSystem } from './system-context.js';

type ResolvedCard = NonNullable<RecipeCard['card']>;

/** The core rendering of `cards/<name>.json` (specs §8.11), inside the plugin's CSS scope. */
function CoreCard({
  card,
  outcome,
  translate,
}: {
  card: ResolvedCard;
  outcome: RecipeCard['outcome'];
  translate: (text: string) => string;
}): ReactElement {
  return (
    <div className="vtt-card flex flex-col gap-1 rounded-lg border border-line bg-surface p-2">
      <p className="font-semibold">{translate(card.title)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
        {card.rows.map((row, index) => (
          <div key={index} className={cn('contents', row.class)}>
            <dt className="text-muted">{translate(row.label)}</dt>
            <dd title={row.error}>{row.error ? '—' : row.value}</dd>
          </div>
        ))}
      </dl>
      {card.outcome && outcome && (
        <p className={cn('vtt-outcome font-semibold', outcome.class)}>{translate(outcome.label)}</p>
      )}
    </div>
  );
}

/**
 * A recipe roll in the chat (FR-CHAT-06): the plugin's custom card component, else the core
 * card, while the table's system has the card; otherwise the message's plain-text fallback
 * and its dice.
 */
export function CardMessage({ message }: { message: ChatMessage }): ReactElement {
  const host = useSystem();
  const recipe = message.card;
  const card = recipe?.card;
  // The stored text, with the dice, which every roll shows (FR-CHAT-04).
  const fallback = (
    <>
      <p className="break-words whitespace-pre-wrap">{message.text}</p>
      {message.rolls.map((roll, index) => (
        <RollView key={index} roll={roll} />
      ))}
    </>
  );
  if (host.status !== 'ready' || !recipe || !card || recipe.system !== host.system.id)
    return fallback;

  const { system, translate } = host;
  const Custom = system.client?.cards?.[card.name];
  const known = Object.hasOwn(system.definition.cards, card.name);
  if (!Custom && !known) return fallback;
  return (
    <div data-plugin={system.id} className="flex flex-col gap-1">
      {Custom ? (
        <PluginBoundary name={card.name}>
          <Custom
            card={recipe}
            rolls={message.rolls}
            speaker={message.speaker}
            translate={translate}
          />
        </PluginBoundary>
      ) : (
        <CoreCard card={card} outcome={recipe.outcome} translate={translate} />
      )}
      {message.rolls.map((roll, index) => (
        <RollView key={index} roll={roll} />
      ))}
    </div>
  );
}
