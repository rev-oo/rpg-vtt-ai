import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActorView, ChatMessage } from '@vtt/shared/api';

import { actors } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { copyReferencePlugin, packedReferencePlugin } from './support/reference.js';

// A reference plugin's compiled code on the server (T-1613): srd5, packed by the CLI as
// its author ships it, runs its handlers in QuickJS against a real table.

let dir: string;
let t: TestApp;
let gm: Client;
let tableId: string;
let rolls: number[];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vtt-reference-code-'));
  await copyReferencePlugin('srd5', path.join(dir, 'plugins', 'srd5'), { code: true });
  rolls = [];
  t = await createTestApp({
    env: { DATA_DIR: dir },
    rng: { nextInt: (n) => Math.min(rolls.shift() ?? 1, n) - 1 },
  });
  gm = await setupAdmin(t.app);
  const headers = authHeaders(gm);
  await t.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  const enabled = await t.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/srd5/enable',
    headers,
    payload: { acknowledgeCode: true },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  tableId = (await createTable(t.app, gm, { systemId: 'srd5' })).id;
}, 60_000);

afterAll(async () => {
  await t.app.close();
  await rm(dir, { recursive: true, force: true });
});

const call = (method: 'POST', url: string, payload: object) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: authHeaders(gm), payload });

async function character(system: Record<string, unknown>): Promise<string> {
  const res = await call('POST', `/tables/${tableId}/actors`, { type: 'character', name: 'Mira' });
  const { actor } = res.json<{ actor: ActorView }>();
  t.db.update(actors).set({ system }).where(eq(actors.id, actor.id)).run();
  return actor.id;
}

const stored = (id: string) =>
  t.db.select({ system: actors.system }).from(actors).where(eq(actors.id, id)).get()?.system;

describe('a reference plugin with its compiled code (T-1613)', () => {
  it('packs the code as the CLI would', async () => {
    const files = await packedReferencePlugin('srd5');
    expect([...files.keys()].filter((file) => file.startsWith('code/')).sort()).toEqual([
      'code/server.js',
      'code/shared.js',
    ]);
  });

  it('rolls a death save with the Exhaustion penalty, and counts it', async () => {
    const id = await character({ hp: { value: 0, max: 10 }, exhaustion: 1 });
    rolls = [13];
    const res = await call('POST', `/tables/${tableId}/rolls`, {
      actorId: id,
      recipe: { name: 'deathSave', args: {} },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { message } = res.json<{ message: ChatMessage }>();
    // Posted by lang key (T-1611): the text is the English, the translation for viewers.
    expect(message.text).toBe('Mira: Death Saving Throw success (1/3).');
    expect(message.translation).toEqual({
      plugin: 'srd5',
      key: 'chat.deathSave.success',
      params: { name: 'Mira', count: 1 },
    });
    expect(message.rolls[0]).toMatchObject({ resolved: '1d20 - 2', total: 11 });
    expect(stored(id)).toMatchObject({ deathSaves: { successes: 1 } });
  });
});
