import { useState, type SubmitEvent } from 'react';

import { errorMessage } from '../../api/errors.js';

/** Runs an async form action, tracking `busy` and a user-facing `error`. */
export function useSubmit(action: () => Promise<void>): {
  busy: boolean;
  error: string | null;
  onSubmit: (event: SubmitEvent) => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return { busy, error, onSubmit };
}
