// Plain ESM, as a plugin build would emit it: React and the SDK come from the app.
import { useEffect, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { defineClient, useActor, useDerived, useField, useTranslate } from '@vtt/sdk/client';

function Banner({ props }) {
  const [hp] = useField('hp');
  const mod = useDerived('mod');
  const actor = useActor();
  const translate = useTranslate();
  return jsx('p', {
    className: 'banner',
    children: `${translate(String(props.label))}: ${actor?.name ?? '?'} has ${String(hp)} HP, mod ${String(mod)}`,
  });
}

/** What the sandbox lets this code reach (T-1502): each check says `blocked` or what it got. */
function attempt(read) {
  try {
    return String(read());
  } catch {
    return 'blocked';
  }
}

function Probe() {
  const [network, setNetwork] = useState('pending');
  useEffect(() => {
    fetch('/api/v1/me').then(
      (response) => setNetwork(`reached ${String(response.status)}`),
      () => setNetwork('blocked'),
    );
  }, []);
  const checks = [
    ['page', attempt(() => window.parent.document.title)],
    ['cookie', attempt(() => document.cookie)],
    ['storage', attempt(() => localStorage.length)],
    ['network', network],
  ];
  return jsx('p', {
    className: 'probe',
    children: checks.map(([name, result]) => `${name}: ${result}`).join('; '),
  });
}

function CheckCard({ card, rolls, translate }) {
  return jsxs('p', {
    className: 'custom-card',
    children: [
      translate(card.card?.title ?? ''),
      ` rolled ${String(rolls[0]?.total)}: `,
      translate(card.outcome?.label ?? ''),
    ],
  });
}

export default defineClient({
  nodes: { banner: Banner, probe: Probe },
  cards: { check: CheckCard },
});
