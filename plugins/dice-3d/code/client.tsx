import { useEffect, useRef, useState, type ReactElement } from 'react';

import {
  defineClient,
  useModuleSettings,
  useSystemDice,
  useTableEvents,
  useViewer,
} from '@vtt/sdk/client';

import { diceOf } from './src/dice.js';
import { readSettings } from './src/settings.js';
import { DiceTable, type Report } from './src/stage.js';

// The 3D dice overlay (T-1604): for each roll the viewer sees, it throws dice over the table
// page and lands them on the server's results. Clicks pass through it; the chat never waits.

function Dice(): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const table = useRef<DiceTable | null>(null);
  // Typed by `vtt-plugin types` from settings.json (T-1611).
  const settings = readSettings(useModuleSettings()[0]);
  const viewer = useViewer();
  const custom = useSystemDice();
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
    const dice = diceOf(
      event.message,
      {
        viewerId: viewer.id,
        showOthers: settings.showOthers,
        maxDice: settings.maxDice,
      },
      custom,
    );
    table.current?.throw(dice, {
      colour: settings.colour,
      seconds: settings.seconds,
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
