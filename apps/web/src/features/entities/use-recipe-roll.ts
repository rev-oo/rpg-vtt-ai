import { useState } from 'react';

import type { Value } from '@vtt/formula';
import type { OptionValue } from '@vtt/plugin-engine';
import type { RollRequestInput } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { useTargets } from '../map/targets.js';

type RecipeArgs = NonNullable<RollRequestInput['recipe']>['args'];

/** Roll arguments as the request takes them; lists cannot be sent. */
function recipeArgs(args: Readonly<Record<string, Value>>): RecipeArgs | null {
  const sent: RecipeArgs = {};
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === 'object') return null;
    sent[name] = value;
  }
  return sent;
}

/**
 * Rolls a sheet's recipes for an actor, made with one of its items when the roll button sits
 * in an item's row or on the item's sheet (ADR-063), at the member's targets when the recipe
 * targets actors (T-1615), and says how it went.
 */
export function useRecipeRoll(tableId: string): {
  roll: (
    actorId: string,
    name: string,
    args: Readonly<Record<string, Value>>,
    itemId?: string,
    options?: Readonly<Record<string, OptionValue>>,
  ) => void;
  status: string | null;
  failure: string | null;
} {
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const system = useSystem();
  const targets = useTargets();
  /** Whether the recipe targets actors, so the roll carries the member's targets (T-1615). */
  const aims = (name: string): boolean => {
    if (system.status !== 'ready') return false;
    const { rolls } = system.system.definition;
    const recipe = Object.hasOwn(rolls, name) ? rolls[name] : undefined;
    return recipe !== undefined && 'target' in recipe && recipe.target !== undefined;
  };

  const roll = (
    actorId: string,
    name: string,
    args: Readonly<Record<string, Value>>,
    itemId?: string,
    options?: Readonly<Record<string, OptionValue>>,
  ) => {
    setStatus(null);
    setFailure(null);
    const sent = recipeArgs(args);
    if (!sent) {
      setFailure(t('sheet.badArgs'));
      return;
    }
    const recipe = {
      name,
      args: sent,
      ...(itemId !== undefined && { itemId }),
      ...(options && { options: { ...options } }),
      ...(aims(name) && targets.ids.length > 0 && { targets: [...targets.ids] }),
    };
    api.roll(tableId, { recipe, actorId }).then(
      () => {
        setStatus(t('sheet.rolled'));
      },
      (error: unknown) => {
        setFailure(errorMessage(error));
      },
    );
  };
  return { roll, status, failure };
}
