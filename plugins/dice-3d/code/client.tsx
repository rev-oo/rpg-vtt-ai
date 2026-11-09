// dice-3d's client code (T-1604): one overlay that throws 3D dice for each roll the viewer sees
// and lands them on the results the server decided. It only shows results; the chat never waits.

import { useEffect, useRef, useState } from 'react';

import { defineClient, useModuleSettings, useTableEvents, useViewer } from '@vtt/sdk/client';

import { diceOf } from './src/dice.js';
import { Stage, type StageOptions, type StageReport } from './src/stage.js';

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const number = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Dice() {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [report, setReport] = useState<StageReport>({ state: 'idle', message: null, shown: [] });
  const [settings] = useModuleSettings();
  const viewer = useViewer();

  const options: StageOptions = {
    diceColour: text(settings.diceColour, '#8b1e2d'),
    numberColour: text(settings.numberColour, '#f6efe3'),
    size: number(settings.size, 1),
    stay: number(settings.stay, 3),
  };
  const mineOnly = settings.rolls === 'rolls.mine';

  useEffect(() => {
    if (!host.current) return;
    const created = new Stage(host.current, setReport);
    stage.current = created;
    const resize = () => {
      created.resize();
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      created.dispose();
      stage.current = null;
    };
  }, []);

  const { diceColour, numberColour, size, stay } = options;
  useEffect(() => {
    stage.current?.setOptions({ diceColour, numberColour, size, stay });
  }, [diceColour, numberColour, size, stay]);

  useTableEvents((event) => {
    if (event.type === 'chat.deleted') {
      stage.current?.clear(event.id);
      return;
    }
    if (event.type !== 'chat.message') return;
    const { message } = event;
    if (mineOnly && message.senderId !== viewer.id) return;
    const dice = diceOf(message.rolls);
    if (dice) stage.current?.throw(message.id, dice, reducedMotion());
  });

  return (
    <div
      ref={host}
      className="dice-3d"
      aria-hidden="true"
      data-state={report.state}
      data-message={report.message ?? undefined}
      data-shown={report.shown.join(' ')}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
    />
  );
}

export default defineClient({ overlays: { dice: { component: Dice } } });
