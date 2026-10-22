import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClientSheetContext,
  defineClient,
  useActor,
  useDerived,
  useField,
  useTranslate,
  type ClientSheet,
} from '../../src/client/index.js';

function Probe() {
  const [hp, setHp] = useField('hp.value');
  const mod = useDerived('strMod');
  const actor = useActor();
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={() => {
        setHp(Number(hp) - 1);
      }}
    >
      {`${t('hp')} ${String(hp)} ${String(mod)} ${actor?.name ?? ''}`}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sheet = (overrides: Partial<ClientSheet> = {}): ClientSheet => ({
  actor: { id: 'a1', name: 'Ayla', type: 'character' },
  readOnly: false,
  get: (path) => (path === 'hp.value' ? 7 : undefined),
  set: vi.fn(),
  adjust: vi.fn(),
  derived: (key) => (key === 'strMod' ? 2 : undefined),
  translate: (text) => text.toUpperCase(),
  ...overrides,
});

describe('@vtt/sdk/client (specs §8.10)', () => {
  it('reads and writes the sheet through the host', () => {
    const value = sheet();
    render(
      <ClientSheetContext.Provider value={value}>
        <Probe />
      </ClientSheetContext.Provider>,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('HP 7 2 Ayla');
    button.click();
    expect(value.set).toHaveBeenCalledWith('hp.value', 6);
  });

  it('does not write while read-only', () => {
    const value = sheet({ readOnly: true });
    render(
      <ClientSheetContext.Provider value={value}>
        <Probe />
      </ClientSheetContext.Provider>,
    );
    screen.getByRole('button').click();
    expect(value.set).not.toHaveBeenCalled();
  });

  it('only works inside a sheet', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/only works inside a plugin sheet node/);
  });

  it('defines client code as given', () => {
    const definition = { nodes: { probe: () => null } };
    expect(defineClient(definition)).toBe(definition);
  });
});
