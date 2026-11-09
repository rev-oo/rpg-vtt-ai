import { useEffect, useRef, useState, type ReactElement } from 'react';

import { defineClient, useModuleSettings, useTableEvents, useViewer } from '@vtt/sdk/client';

import { diceOf } from './src/dice.js';
import { COLOURS, DiceTable, type Colour, type Report } from './src/stage.js';

// The 3D dice overlay (T-1604): for each roll the viewer sees, it throws dice over the table
// page and lands them on the server's results. Clicks pass through it; the chat never waits.

const isColour = (value: unknown): value is Colour =>
  typeof value === 'string' && Object.hasOwn(COLOURS, value);

const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function Dice(): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const table = useRef<DiceTable | null>(null);
  const [settings] = useModuleSettings();
  const viewer = useViewer();
  const [report, setReport] = useState<Report>({ state: 'idle', shown: [], drawing: false });

  useEffect(() => {
    if (!host.current) return undefined;
    const made = new DiceTable(host.current, setReport);
    table.current = made;
    return () => {
      made.dispose();
      table.current = null;
    };
  }, []);

  useTableEvents((event) => {
    // A new message only: an edited one was thrown when it arrived.
    if (event.type !== 'chat.message' || event.message.rolls.length === 0) return;
    const dice = diceOf(event.message, {
      viewerId: viewer.id,
      showOthers: settings.showOthers !== false,
      maxDice: number(settings.maxDice, 20),
    });
    table.current?.throw(dice, {
      colour: isColour(settings.colour) ? settings.colour : 'ivory',
      seconds: number(settings.seconds, 3),
    });
  });

  // The state is on the element, for the e2e suite and for anyone inspecting the frame.
  return (
    <div
      ref={host}
      className="dice-3d"
      data-state={report.state}
      data-shown={report.shown.join(' ')}
      data-drawing={String(report.drawing)}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    />
  );
}

export default defineClient({ overlays: { dice: { component: Dice } } });
