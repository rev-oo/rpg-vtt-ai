import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useModuleSettings, useTableEvents, useViewer } from '@vtt/sdk/client';

import { throwFor } from './dice.js';
import { DiceScene, type Look, type State } from './scene.js';

const COLOUR = /^#[0-9a-f]{6}$/i;
const HEIGHT: Readonly<Record<string, number>> = {
  'size.small': 40,
  'size.medium': 30,
  'size.large': 22,
};

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;
const colour = (value: unknown, fallback: string): string => {
  const given = text(value, fallback);
  return COLOUR.test(given) ? given : fallback;
};

function stillPreferred(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The dice overlay: a transparent canvas over the table page. Each roll the viewer sees
 * arrives in a chat message with the server's results; the dice are thrown, then land on
 * them. The chat never waits for the dice.
 */
export function DiceOverlay(): ReactElement {
  const [settings] = useModuleSettings();
  const viewer = useViewer();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<DiceScene | null>(null);
  const [state, setState] = useState<State>('idle');
  const [results, setResults] = useState('');

  const look: Look = {
    colour: colour(settings.colour, '#8b1e1e'),
    numbers: colour(settings.numbers, '#ffffff'),
    height: HEIGHT[text(settings.size, '')] ?? 30,
    seconds: typeof settings.seconds === 'number' ? settings.seconds : 3,
    still: stillPreferred(),
  };
  const latest = useRef(look);
  useEffect(() => {
    latest.current = look;
    scene.current?.setLook(look);
  });

  // The WebGL canvas exists only while dice are on screen, so an idle table holds no context.
  useEffect(() => {
    if (state !== 'idle' || !scene.current) return;
    const idle = scene.current;
    const timer = window.setTimeout(() => {
      if (!idle.idle) return;
      idle.canvas.remove();
      idle.dispose();
      if (scene.current === idle) scene.current = null;
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);

  useEffect(() => {
    const resize = () => scene.current?.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useTableEvents((event) => {
    if (event.type !== 'chat.message' || event.message.rolls.length === 0) return;
    if (settings.whose === 'whose.mine' && event.message.senderId !== viewer.id) return;
    const thrown = throwFor(event.message);
    if (thrown.dice.length === 0) return;
    if (!scene.current) {
      scene.current = new DiceScene(latest.current, setState);
      host.current?.append(scene.current.canvas);
    }
    setResults(thrown.results.join(' '));
    scene.current.throw(thrown);
  });

  return (
    <div
      ref={host}
      className="dice"
      data-state={state}
      data-results={results}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}
    />
  );
}
