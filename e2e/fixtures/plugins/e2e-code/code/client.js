// Plain ESM, as a plugin build would emit it: React and the SDK come from the app.
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

export default defineClient({ nodes: { banner: Banner }, cards: { check: CheckCard } });
