import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';

import { canRunCombat } from '@vtt/shared';
import type { ActorView, EncounterView, TableView } from '@vtt/shared/api';
import { Alert, Button, cn, Select, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { useTableEvents } from '../../realtime/use-table-events.js';

interface CombatTrackerProps {
  table: TableView;
  /** The actors the member can see, to add as combatants. */
  actors: readonly ActorView[];
}

/**
 * The table's encounter (FR-COMBAT-01, 03, 04; ADR-049): its round and turn order for every
 * member, with controls for GMs and assistants. It refetches on `combat.updated`, so what a
 * member sees is always what the server filtered for them.
 */
export function CombatTracker({ table, actors }: CombatTrackerProps): ReactElement | null {
  const [encounter, setEncounter] = useState<EncounterView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const runs = canRunCombat(table.role);
  const system = useSystem();
  // The system's combat.json rolls initiative (FR-COMBAT-02); otherwise the GM types it.
  const rolls =
    system.status === 'ready' && system.system.definition.combat?.initiative !== undefined;

  const refresh = useCallback(() => {
    api.getEncounter(table.id).then(
      (next) => {
        setEncounter(next);
      },
      (e: unknown) => {
        setError(errorMessage(e));
      },
    );
  }, [table.id]);
  useEffect(refresh, [refresh]);
  useTableEvents(table.id, {
    onEvent: (event) => {
      if (event.type === 'combat.updated') refresh();
    },
    onResync: refresh,
  });

  /** Runs a GM change; its answer is the encounter as the GM sees it. */
  const change = (action: () => Promise<EncounterView | null>) => {
    setError(null);
    action().then(
      (next) => {
        setEncounter(next);
      },
      (e: unknown) => {
        setError(errorMessage(e));
      },
    );
  };

  if (encounter === undefined || (encounter === null && !runs)) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {encounter && encounter.round > 0 && (
          <p className="text-sm text-muted">{t('combat.round', { round: encounter.round })}</p>
        )}
        {runs && encounter && (
          <div className="flex flex-wrap gap-1">
            {rolls && encounter.combatants.some((c) => c.initiative === null) && (
              <Button
                onClick={() => {
                  change(() => api.rollInitiative(table.id));
                }}
              >
                {t('combat.rollInitiative')}
              </Button>
            )}
            {encounter.round === 0 ? (
              <Button
                variant="primary"
                onClick={() => {
                  change(() => api.startEncounter(table.id));
                }}
              >
                {t('combat.start')}
              </Button>
            ) : (
              <>
                <Button
                  onClick={() => {
                    change(() => api.moveTurn(table.id, 'previous'));
                  }}
                >
                  {t('combat.previous')}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    change(() => api.moveTurn(table.id, 'next'));
                  }}
                >
                  {t('combat.next')}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                change(() => api.endEncounter(table.id).then(() => null));
              }}
            >
              {t('combat.end')}
            </Button>
          </div>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {encounter === null ? (
        <Button
          onClick={() => {
            change(() => api.createEncounter(table.id));
          }}
        >
          {t('combat.create')}
        </Button>
      ) : (
        <>
          {encounter.combatants.length === 0 ? (
            <p className="text-sm text-muted">{t('combat.empty')}</p>
          ) : (
            <ol aria-label={t('combat.order')} className="flex flex-col gap-1">
              {encounter.combatants.map((combatant) => {
                const current = combatant.id === encounter.currentId;
                return (
                  <li
                    key={combatant.id}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-1',
                      current && 'bg-info-soft font-semibold',
                    )}
                  >
                    <span className="w-10 text-right tabular-nums text-muted">
                      {combatant.initiative ?? '–'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{combatant.name}</span>
                    {combatant.hidden && (
                      <span className="text-xs text-muted">{t('combat.hidden')}</span>
                    )}
                    {runs && (
                      <CombatantControls
                        name={combatant.name}
                        hidden={combatant.hidden}
                        initiative={combatant.initiative}
                        onInitiative={(initiative) => {
                          change(() => api.updateCombatant(table.id, combatant.id, { initiative }));
                        }}
                        onToggleHidden={() => {
                          change(() =>
                            api.updateCombatant(table.id, combatant.id, {
                              hidden: !combatant.hidden,
                            }),
                          );
                        }}
                        onRemove={() => {
                          change(() => api.removeCombatant(table.id, combatant.id));
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {runs && (
            <AddCombatant
              actors={actors}
              onAdd={(input) => {
                change(() => api.addCombatant(table.id, input));
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function CombatantControls({
  name,
  hidden,
  initiative,
  onInitiative,
  onToggleHidden,
  onRemove,
}: {
  name: string;
  hidden: boolean;
  initiative: number | null;
  onInitiative: (value: number | null) => void;
  onToggleHidden: () => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        aria-label={t('combat.initiativeOf', { name })}
        defaultValue={initiative ?? ''}
        key={initiative ?? 'none'}
        className="w-16 rounded border border-line bg-canvas px-1 text-sm"
        onBlur={(event) => {
          const raw = event.currentTarget.value.trim();
          const value = raw === '' ? null : Number(raw);
          if (value !== initiative && (value === null || Number.isFinite(value))) {
            onInitiative(value);
          }
        }}
      />
      <Button
        variant="ghost"
        aria-label={t(hidden ? 'combat.revealOf' : 'combat.hideOf', { name })}
        onClick={onToggleHidden}
      >
        {t(hidden ? 'combat.reveal' : 'combat.hide')}
      </Button>
      <Button variant="ghost" aria-label={t('combat.removeOf', { name })} onClick={onRemove}>
        ×
      </Button>
    </span>
  );
}

/** Adds an actor of the table, or a free-form entry by name. */
function AddCombatant({
  actors,
  onAdd,
}: {
  actors: readonly ActorView[];
  onAdd: (input: { actorId?: string; name?: string; hidden: boolean }) => void;
}): ReactElement {
  const [actorId, setActorId] = useState('');
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!actorId && !trimmed) return;
    onAdd({
      ...(actorId && { actorId }),
      ...(trimmed && { name: trimmed }),
      hidden,
    });
    setActorId('');
    setName('');
    setHidden(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
      <Select
        label={t('combat.actor')}
        value={actorId}
        onChange={(event) => {
          setActorId(event.target.value);
        }}
      >
        <option value="">{t('combat.freeForm')}</option>
        {actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </Select>
      <TextField
        label={t('combat.name')}
        value={name}
        maxLength={100}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => {
            setHidden(event.target.checked);
          }}
        />
        {t('combat.hidden')}
      </label>
      <Button type="submit">{t('combat.add')}</Button>
    </form>
  );
}
