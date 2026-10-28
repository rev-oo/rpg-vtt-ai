import { useState, type ReactElement } from 'react';

import { canSendChat } from '@vtt/shared';
import type { ActorView, TableView } from '@vtt/shared/api';
import { Alert, Button, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

const DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const;

/**
 * The phone layout's dice pane (T-0511): common dice and a formula, rolled as the sheet's
 * actor when the viewer owns it. Results go to the chat like any roll (FR-CHAT-03).
 */
export function DicePane({
  table,
  actor,
}: {
  table: TableView;
  actor: ActorView | undefined;
}): ReactElement {
  const [formula, setFormula] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const actorId = actor?.access === 'owner' ? actor.id : null;
  const mayRoll = canSendChat(table.role);

  const roll = (text: string) => {
    setStatus(null);
    setFailure(null);
    api.roll(table.id, { formula: text, actorId }).then(
      () => {
        setStatus(t('sheet.rolled'));
      },
      (error: unknown) => {
        setFailure(errorMessage(error));
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {!mayRoll && <Alert tone="info">{t('dice.spectator')}</Alert>}
      <div className="grid grid-cols-4 gap-2">
        {DICE.map((die) => (
          <Button
            key={die}
            disabled={!mayRoll}
            aria-label={t('dice.rollDie', { die })}
            onClick={() => {
              roll(`1${die}`);
            }}
          >
            {die}
          </Button>
        ))}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (formula.trim()) roll(formula);
        }}
      >
        <TextField
          className="min-w-0 flex-1"
          label={t('dice.formula')}
          value={formula}
          disabled={!mayRoll}
          onChange={(event) => {
            setFormula(event.target.value);
          }}
        />
        <Button type="submit" variant="primary" disabled={!mayRoll || !formula.trim()}>
          {t('dice.roll')}
        </Button>
      </form>
      {failure && <Alert tone="error">{failure}</Alert>}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
    </div>
  );
}
