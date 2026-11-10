import { useState, type ReactElement } from 'react';

import type { ChatMessage, RecipeCard } from '@vtt/shared/api';
import { Button, cn } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { RollView } from '../features/chat/RollView.js';
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
 * The actors a roll targeted (T-1615), each with the card's actions, such as applying damage,
 * for members who may edit it. An action is done once per target; the card then shows it done
 * to everyone, through the message's update.
 */
function CardTargets({
  messageId,
  recipe,
  translate,
  canEdit,
}: {
  messageId: string;
  recipe: RecipeCard;
  translate: (text: string) => string;
  canEdit: (actorId: string) => boolean;
}): ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const targets = recipe.targets ?? [];
  if (targets.length === 0) return null;
  const actions = (recipe.card?.apply ?? [])
    .map((action, index) => ({ ...action, index }))
    .filter((action) => action.error === undefined);
  const apply = (target: number, action: number) => {
    setBusy(true);
    setFailure(null);
    api
      .applyCardAction(messageId, { target, action })
      .catch((error: unknown) => {
        setFailure(errorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <div className="vtt-card-targets flex flex-col gap-1 text-sm">
      <p className="text-muted">{t('card.targets')}</p>
      <ul className="flex flex-col gap-1">
        {targets.map((target, index) => (
          <li key={target.tokenId} className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{target.name}</span>
            {canEdit(target.actorId) &&
              actions.map((action) => {
                const done = target.applied.includes(action.index);
                const label = translate(action.label);
                return (
                  <Button
                    key={action.index}
                    variant="secondary"
                    className="px-2 py-0.5 text-xs"
                    disabled={done || busy}
                    aria-label={t(done ? 'card.applied' : 'card.apply', {
                      action: label,
                      name: target.name,
                    })}
                    onClick={() => {
                      apply(index, action.index);
                    }}
                  >
                    {done ? `${label} ✓` : label}
                  </Button>
                );
              })}
          </li>
        ))}
      </ul>
      {failure && (
        <p role="alert" className="text-danger">
          {failure}
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
  canEdit = () => false,
}: {
  message: ChatMessage;
  /** Whether the member may edit an actor, so the card offers its actions on it (T-1615). */
  canEdit?: (actorId: string) => boolean;
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
      <CardTargets messageId={message.id} recipe={recipe} translate={translate} canEdit={canEdit} />
      {message.rolls.map((roll, index) => (
        <RollView key={index} roll={roll} />
      ))}
    </div>
  );
}
