import { useState, type ReactElement } from 'react';

import type { OptionValue } from '@vtt/plugin-engine';
import type { RollShortcut } from '@vtt/plugin-schema';
import type { CardAction, ChatMessage, RecipeCard } from '@vtt/shared/api';
import { Button, cn } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { RollView } from '../features/chat/RollView.js';
import { useSelectedToken } from '../features/map/selection.js';
import { t } from '../i18n/index.js';

import { PluginFrame } from './PluginFrame.js';
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
            {/* A value that is a lang key is translated (T-1611): `'damage.' + @item.damageType`. */}
            <dd title={row.error}>{row.error ? '—' : translate(row.value)}</dd>
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
 * The card's actions (T-1617), acting on the token the viewer has selected on the map: an
 * apply action steps one of its actor's counters, a roll action rolls a recipe for that actor.
 * The server checks that the viewer may do either.
 */
function CardActions({
  message,
  actions,
  translate,
}: {
  message: ChatMessage;
  actions: readonly CardAction[];
  translate: (text: string) => string;
}): ReactElement {
  const host = useSystem();
  const selected = useSelectedToken(message.tableId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const actorId = selected?.actorId ?? null;
  const rolls = host.status === 'ready' ? host.system.definition.rolls : {};

  const run = (work: Promise<string>) => {
    setBusy(true);
    setStatus(null);
    work
      .then(
        (text) => {
          setStatus({ text, failed: false });
        },
        (error: unknown) => {
          setStatus({ text: errorMessage(error), failed: true });
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };
  /**
   * Shift and Ctrl (or ⌘) pick the choice that names them, as on a sheet (T-1609); the server
   * fills in the other options' defaults, which may read the actor.
   */
  const picked = (
    name: string,
    key: RollShortcut | null,
  ): Record<string, OptionValue> | undefined => {
    const recipe = Object.hasOwn(rolls, name) ? rolls[name] : undefined;
    if (!key || !recipe || !('formula' in recipe)) return undefined;
    for (const [option, asked] of Object.entries(recipe.options ?? {})) {
      if (asked.type !== 'choice') continue;
      const choice = asked.choices.find((candidate) => candidate.key === key);
      if (choice) return { [option]: choice.value };
    }
    return undefined;
  };

  return (
    <div data-vtt-part="card-actions" className="flex flex-col gap-1">
      <p className="text-xs text-muted">
        {selected ? t('chat.actionsOn', { name: selected.name }) : t('chat.actionsSelect')}
      </p>
      <div className="flex flex-wrap gap-1">
        {actions.map((action, index) => (
          <Button
            key={index}
            variant="ghost"
            className="vtt-card-action"
            disabled={busy || actorId === null || action.error !== undefined}
            title={action.error}
            onClick={(event) => {
              if (actorId === null || !selected) return;
              if (action.kind === 'apply') {
                run(
                  api
                    .applyCardAction(message.id, { action: index, actorId })
                    .then((value) =>
                      t('chat.actionApplied', { name: selected.name, value: String(value) }),
                    ),
                );
                return;
              }
              const key = event.shiftKey ? 'shift' : event.ctrlKey || event.metaKey ? 'ctrl' : null;
              const options = picked(action.roll, key);
              run(
                api
                  .roll(message.tableId, {
                    recipe: { name: action.roll, args: action.args, ...(options && { options }) },
                    actorId,
                  })
                  .then(() => t('chat.actionRolled', { name: selected.name })),
              );
            }}
          >
            {translate(action.label)}
          </Button>
        ))}
      </div>
      {status && (
        <p role="status" className={cn('text-xs', status.failed ? 'text-danger' : 'text-muted')}>
          {status.text}
        </p>
      )}
    </div>
  );
}

/**
 * A recipe roll in the chat (FR-CHAT-06): the plugin's custom card component, else the core
 * card, while the table's system has the card; otherwise the message's plain-text fallback
 * and its dice.
 */
export function CardMessage({
  message,
  canAct,
}: {
  message: ChatMessage;
  /** Whether the viewer may use the card's actions; spectators may not. */
  canAct: boolean;
}): ReactElement {
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
  const custom = system.client?.cards.includes(card.name) ? system.client : null;
  const known = Object.hasOwn(system.definition.cards, card.name);
  if (!custom && !known) return fallback;
  return (
    <div data-plugin={system.id} className="flex flex-col gap-1">
      {custom ? (
        <PluginFrame
          code={custom.frame}
          title={card.name}
          view={{
            kind: 'card',
            name: card.name,
            card: recipe,
            rolls: message.rolls,
            speaker: message.speaker,
          }}
        />
      ) : (
        <CoreCard card={card} outcome={recipe.outcome} translate={translate} />
      )}
      {canAct && card.actions && card.actions.length > 0 && (
        <CardActions message={message} actions={card.actions} translate={translate} />
      )}
      {message.rolls.map((roll, index) => (
        <RollView key={index} roll={roll} />
      ))}
    </div>
  );
}
