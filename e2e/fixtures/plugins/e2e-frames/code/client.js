// Plain ESM, as a plugin build would emit it: React and the SDK come from the app (ADR-077).
import { useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import {
  defineClient,
  useActions,
  useModuleSettings,
  useTableEvents,
  useViewer,
} from '@vtt/sdk/client';

/** The total of the last roll the viewer saw, under the viewer's own label. */
function LastRoll() {
  const [total, setTotal] = useState(null);
  const [settings] = useModuleSettings();
  useTableEvents((event) => {
    if (event.type === 'chat.message' && event.message.rolls.length > 0) {
      setTotal(event.message.rolls[0].total);
    }
  });
  return jsx('p', {
    className: 'last-roll',
    style: { position: 'fixed', bottom: '1rem', left: '1rem', margin: 0 },
    children: `${String(settings.label)}: ${total === null ? 'none' : String(total)}`,
  });
}

function attempt(read) {
  try {
    return String(read());
  } catch {
    return 'blocked';
  }
}

function Tools() {
  const actions = useActions();
  const viewer = useViewer();
  const [, setSetting] = useModuleSettings();
  const [status, setStatus] = useState('idle');
  const [network, setNetwork] = useState('pending');
  useEffect(() => {
    fetch('/api/v1/me').then(
      (response) => setNetwork(`reached ${String(response.status)}`),
      () => setNetwork('blocked'),
    );
  }, []);
  const run = (label, task) => {
    task().then(
      () => setStatus(`${label}: done`),
      (error) => setStatus(`${label}: ${error.message}`),
    );
  };
  const button = (label, task) =>
    jsx('button', { type: 'button', onClick: () => run(label, task), children: label });
  return jsxs('div', {
    children: [
      jsx('p', { className: 'viewer', children: `role: ${viewer.role}` }),
      button('Roll d20', () => actions.roll('1d20')),
      button('Start combat', () => actions.combat('start')),
      button('Rename label', () => setSetting('label', 'Mine')),
      jsx('p', { className: 'status', children: status }),
      jsx('p', {
        className: 'probe',
        children: [
          `page: ${attempt(() => window.parent.document.title)}`,
          `storage: ${attempt(() => localStorage.length)}`,
          `network: ${network}`,
        ].join('; '),
      }),
    ],
  });
}

export default defineClient({
  overlays: { lastRoll: { component: LastRoll } },
  panels: { tools: { component: Tools, title: 'panel.title' } },
});
