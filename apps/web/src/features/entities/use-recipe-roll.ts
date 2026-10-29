import { useState } from 'react';

import type { Value } from '@vtt/formula';
import type { RollRequestInput } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

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
 * in an item's row or on the item's sheet (ADR-063), and says how it went.
 */
export function useRecipeRoll(tableId: string): {
  roll: (
    actorId: string,
    name: string,
    args: Readonly<Record<string, Value>>,
    itemId?: string,
  ) => void;
  status: string | null;
  failure: string | null;
} {
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const roll = (
    actorId: string,
    name: string,
    args: Readonly<Record<string, Value>>,
    itemId?: string,
  ) => {
    setStatus(null);
    setFailure(null);
    const sent = recipeArgs(args);
    if (!sent) {
      setFailure(t('sheet.badArgs'));
      return;
    }
    const recipe = { name, args: sent, ...(itemId !== undefined && { itemId }) };
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
