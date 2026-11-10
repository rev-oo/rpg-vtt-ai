import { useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';

import type { Value } from '@vtt/formula';
import type { EncounterView } from '@vtt/shared/api';

import {
  ModuleFrameContext,
  type CombatAction,
  type ModuleActions,
  type ModuleFrame,
  type PostOptions,
  type SystemDie,
  type TableEvent,
  type Viewer,
} from './index.js';

// `@vtt/sdk/client/testing` (T-1613): renders a module's overlay or panel outside a frame, with
// table events, settings and dice the test gives, and records what the component asked for.
// It only stands in for the host: render with React Testing Library or `react-dom` as usual.

/** Something a module asked the host for, as the test frame recorded it. */
export type FrameCall =
  | { kind: 'sendChat'; text: string; options?: PostOptions }
  | { kind: 'roll'; formula: string; options?: PostOptions }
  | { kind: 'openSheet'; actorId: string }
  | { kind: 'openJournal'; entryId: string }
  | { kind: 'combat'; action: CombatAction }
  | { kind: 'encounter' }
  | { kind: 'setSetting'; name: string; value: Value };

export interface TestFrameOptions {
  tableId?: string;
  /** Who views the table; a player by default. */
  viewer?: Viewer;
  /** The module's settings for the viewer. */
  settings?: Readonly<Record<string, Value>>;
  /** The table system's custom dice, as `useSystemDice` gives them. */
  dice?: Readonly<Record<string, SystemDie>>;
  /** The module's texts by lang key, for `useTranslate`; other keys show as written. */
  lang?: Readonly<Record<string, string>>;
  /** What `actions.encounter()` answers; none by default. */
  encounter?: EncounterView | null;
  /** Refuses a call with a reason, as the server would refuse the viewer; none by default. */
  refuse?: (call: FrameCall) => string | undefined;
}

export interface TestFrame {
  /** Provides the frame: render the overlay or panel inside it. */
  Provider: (props: { children?: ReactNode }) => ReactElement;
  /** Sends a table event to the components listening, as the host would. Wrap it in `act`. */
  emit: (event: TableEvent) => void;
  /** Changes the viewer's settings, as when the GM changes them. Wrap it in `act`. */
  setSettings: (settings: Readonly<Record<string, Value>>) => void;
  /** Changes the system's dice, as when the system loads. Wrap it in `act`. */
  setDice: (dice: Readonly<Record<string, SystemDie>>) => void;
  /** Every call the components made, in order, refused ones included. */
  calls: FrameCall[];
  /** The settings now, after any `setSetting` the components made. */
  readonly settings: Readonly<Record<string, Value>>;
}

interface State {
  settings: Readonly<Record<string, Value>>;
  dice: Readonly<Record<string, SystemDie>>;
}

/** A frame for one test (T-1613): make one per test, so calls and listeners do not mix. */
export function createTestFrame(options: TestFrameOptions = {}): TestFrame {
  const tableId = options.tableId ?? 'table-1';
  const viewer: Viewer = options.viewer ?? { id: 'user-1', role: 'player' };
  const lang = options.lang ?? {};
  const translate = (text: string) => (Object.hasOwn(lang, text) ? (lang[text] ?? text) : text);
  let state: State = { settings: options.settings ?? {}, dice: options.dice ?? {} };
  const watchers = new Set<() => void>();
  const listeners = new Set<(event: TableEvent) => void>();
  const calls: FrameCall[] = [];

  const update = (change: Partial<State>) => {
    state = { ...state, ...change };
    for (const watch of watchers) watch();
  };
  const subscribe = (watch: () => void) => {
    watchers.add(watch);
    return () => {
      watchers.delete(watch);
    };
  };
  const ask = <T,>(call: FrameCall, value: T): Promise<T> => {
    calls.push(call);
    const reason = options.refuse?.(call);
    return reason === undefined ? Promise.resolve(value) : Promise.reject(new Error(reason));
  };
  const actions: ModuleActions = {
    sendChat: (text, postOptions) =>
      ask(
        { kind: 'sendChat', text, ...(postOptions !== undefined && { options: postOptions }) },
        undefined,
      ),
    roll: (formula, postOptions) =>
      ask(
        { kind: 'roll', formula, ...(postOptions !== undefined && { options: postOptions }) },
        undefined,
      ),
    openSheet: (actorId) => ask({ kind: 'openSheet', actorId }, undefined),
    openJournal: (entryId) => ask({ kind: 'openJournal', entryId }, undefined),
    combat: (action) => ask({ kind: 'combat', action }, undefined),
    encounter: () => ask({ kind: 'encounter' }, options.encounter ?? null),
  };
  const setSetting = async (name: string, value: Value) => {
    await ask({ kind: 'setSetting', name, value }, undefined);
    update({ settings: { ...state.settings, [name]: value } });
  };
  const listen = (listener: (event: TableEvent) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  function Provider({ children }: { children?: ReactNode }): ReactElement {
    const current = useSyncExternalStore(subscribe, () => state);
    const frame = useMemo(
      (): ModuleFrame => ({
        tableId,
        viewer,
        settings: current.settings,
        dice: current.dice,
        setSetting,
        listen,
        actions,
        translate,
      }),
      [current],
    );
    return <ModuleFrameContext.Provider value={frame}>{children}</ModuleFrameContext.Provider>;
  }

  return {
    Provider,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    setSettings: (settings) => {
      update({ settings });
    },
    setDice: (dice) => {
      update({ dice });
    },
    calls,
    get settings() {
      return state.settings;
    },
  };
}
