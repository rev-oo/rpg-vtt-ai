import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Rng } from '@vtt/formula';
import type { ActorView, ChatMessage, RollRequestInput } from '@vtt/shared/api';

import { actors } from '../src/db/schema.js';
import { secureRng } from '../src/domain/rolls.js';

import type { Client } from './support/app.js';
import { openSocket, type TestSocket } from './support/socket.js';
import { setupTable, type TableMember, type TableSetup } from './support/table.js';

/** An RNG that cycles through standard-die faces, so totals are known. */
function faces(...values: number[]): Rng {
  let next = 0;
  return {
    nextInt: (n) => {
      const face = values[next % values.length] ?? 1;
      next += 1;
      return Math.min(face, n) - 1;
    },
  };
}

const rollAs = (t: TableSetup, who: TableMember, payload: RollRequestInput) =>
  t.call(who.client, 'POST', `/tables/${t.table.id}/rolls`, payload);

async function history(t: TableSetup, client: Client): Promise<ChatMessage[]> {
  const res = await t.call(client, 'GET', `/tables/${t.table.id}/messages`);
  expect(res.statusCode).toBe(200);
  return res.json<{ messages: ChatMessage[] }>().messages;
}

/** Bob's character, whose data the roll reads (FR-DICE-02). */
async function bobsHero(t: TableSetup): Promise<ActorView> {
  const res = await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
    type: 'character',
    name: 'Bob the Brave',
  });
  const { actor } = res.json<{ actor: ActorView }>();
  // Plugin data is written by sheets (M5); the test sets it directly.
  t.db
    .update(actors)
    .set({ system: { str: 14, skills: { climb: { rank: 3 } } } })
    .where(eq(actors.id, actor.id))
    .run();
  return actor;
}

describe('POST /tables/:id/rolls (T-0305, FR-CHAT-03, 04, 08)', () => {
  it('rolls a formula and stores every die', async () => {
    const t = await setupTable({ rng: faces(4, 6) });
    const res = await rollAs(t, t.bob, { formula: '2d6 + 1' });
    expect(res.statusCode).toBe(201);
    const { message } = res.json<{ message: ChatMessage }>();
    expect(message).toMatchObject({
      kind: 'roll',
      text: '2d6 + 1',
      audience: 'public',
      senderId: t.bob.userId,
      speaker: { name: 'bob', actorId: null },
      rolls: [
        {
          expression: '2d6 + 1',
          resolved: '2d6 + 1',
          total: 11,
          dice: [
            {
              formula: '2d6',
              total: 10,
              results: [
                { value: 4, active: true },
                { value: 6, active: true },
              ],
            },
          ],
        },
      ],
    });
    // History returns the same roll.
    expect((await history(t, t.carol.client))[0]).toEqual(message);
  });

  it("reads an actor's data and speaks as it (FR-DICE-02)", async () => {
    const t = await setupTable({ rng: faces(12) });
    const hero = await bobsHero(t);
    // The GM: `test-system` has no definition, so players see none of its data (FR-SHEET-04).
    // Players reading their own data with a real plugin is in system-rolls and secrets tests.
    const res = await rollAs(t, t.gm, {
      formula: '1d20 + floor((@str - 10) / 2) + @skills.climb.rank',
      actorId: hero.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ message: ChatMessage }>().message).toMatchObject({
      speaker: { name: 'Bob the Brave', actorId: hero.id },
      rolls: [{ resolved: '1d20 + floor((14 - 10) / 2) + 3', total: 17 }],
    });
  });

  it('explains formulas that cannot be rolled', async () => {
    const t = await setupTable();
    const syntax = await rollAs(t, t.bob, { formula: '1d20 +\n  * 2' });
    expect(syntax.statusCode).toBe(422);
    expect(syntax.json()).toEqual({
      error: {
        code: 'invalid_formula',
        message: 'Unexpected "*" (line 2, column 3)',
        details: { reason: 'unexpected_token', line: 2, column: 3 },
      },
    });
    // Without an actor there is no data to reference.
    const reference = await rollAs(t, t.bob, { formula: '1d20 + @str' });
    expect(reference.json()).toMatchObject({
      error: { code: 'invalid_formula', details: { reason: 'unknown_reference' } },
    });
    const dice = await rollAs(t, t.bob, { formula: '5000d6' });
    expect(dice.json()).toMatchObject({ error: { details: { reason: 'too_many_dice' } } });
    expect(await history(t, t.bob.client)).toEqual([]);
  });

  it('checks the request like a chat message', async () => {
    const t = await setupTable();
    const hero = await bobsHero(t);
    expect((await rollAs(t, t.bob, { formula: '' })).statusCode).toBe(400);
    expect((await rollAs(t, t.bob, { formula: '1'.repeat(501) })).statusCode).toBe(400);
    // Spectators may not roll; non-members do not see the table.
    expect((await rollAs(t, t.dave, { formula: '1d6' })).statusCode).toBe(403);
    expect((await rollAs(t, t.eve, { formula: '1d6' })).statusCode).toBe(404);
    // Only the owner rolls as an actor.
    expect((await rollAs(t, t.carol, { formula: '1d6', actorId: hero.id })).json()).toMatchObject({
      error: { code: 'invalid_speaker' },
    });
    expect(
      (
        await rollAs(t, t.bob, {
          formula: '1d6',
          audience: 'whisper',
          recipientIds: [t.eve.userId],
        })
      ).json(),
    ).toMatchObject({ error: { code: 'invalid_recipient' } });
  });

  it('uses a cryptographically secure RNG by default (FR-CHAT-04)', () => {
    for (const n of [1, 6, 20, 1000]) {
      const value = secureRng.nextInt(n);
      expect(Number.isInteger(value) && value >= 0 && value < n).toBe(true);
    }
  });
});

describe('secret and whispered rolls on the wire (FR-CHAT-05, NFR-08)', () => {
  async function listeners(t: TableSetup) {
    const sockets: Record<'gm' | 'bob' | 'carol' | 'dave', TestSocket> = {
      gm: await openSocket(t.app, t.gm.client),
      bob: await openSocket(t.app, t.bob.client),
      carol: await openSocket(t.app, t.carol.client),
      dave: await openSocket(t.app, t.dave.client),
    };
    for (const socket of Object.values(sockets)) {
      await socket.request({ type: 'subscribe', tableId: t.table.id });
    }
    return sockets;
  }

  /** The totals each socket received, once everything sent so far has arrived. */
  async function totals(sockets: Record<string, TestSocket>) {
    await Promise.all(Object.values(sockets).map((s) => s.flush()));
    return Object.fromEntries(
      Object.entries(sockets).map(([name, s]) => [
        name,
        s.ofType('chat.message').map((e) => e.payload.message.rolls[0]?.expression),
      ]),
    );
  }

  it('shows secret rolls only to the roller and the GM side', async () => {
    const t = await setupTable({ rng: faces(17) });
    const sockets = await listeners(t);
    const request = (socket: TestSocket, payload: RollRequestInput) =>
      socket.request({ type: 'roll.request', tableId: t.table.id, payload });

    expect((await request(sockets.bob, { formula: '1d20 + 100' })).type).toBe('ack');
    expect((await request(sockets.bob, { formula: '1d20 + 200', audience: 'gm' })).type).toBe(
      'ack',
    );
    await request(sockets.gm, { formula: '1d20 + 300', audience: 'gm' });
    await request(sockets.bob, {
      formula: '1d20 + 400',
      audience: 'whisper',
      recipientIds: [t.carol.userId],
    });

    expect(await totals(sockets)).toEqual({
      gm: ['1d20 + 100', '1d20 + 200', '1d20 + 300'],
      bob: ['1d20 + 100', '1d20 + 200', '1d20 + 400'],
      carol: ['1d20 + 100', '1d20 + 400'],
      dave: ['1d20 + 100'],
    });
    // Nothing of a secret roll reaches a player's socket: neither its id nor its formula.
    const secrets = sockets.gm
      .ofType('chat.message')
      .slice(1)
      .map((e) => e.payload.message);
    for (const socket of [sockets.carol, sockets.dave]) {
      const wire = JSON.stringify(socket.received);
      for (const secret of secrets) expect(wire).not.toContain(secret.id);
      expect(wire).not.toContain('+ 200');
      expect(wire).not.toContain('+ 300');
    }
    // History filters them the same way.
    expect((await history(t, t.carol.client)).map((m) => m.text)).toEqual([
      '1d20 + 400',
      '1d20 + 100',
    ]);
    expect((await history(t, t.gm.client)).map((m) => m.rolls[0]?.total)).toEqual([317, 217, 117]);
  });

  it('answers refused rolls with an error and sends nothing', async () => {
    const t = await setupTable();
    const sockets = await listeners(t);
    const refused = await sockets.dave.request({
      type: 'roll.request',
      tableId: t.table.id,
      payload: { formula: '1d6' },
    });
    expect(refused).toMatchObject({ type: 'error', payload: { code: 'forbidden' } });
    const invalid = await sockets.bob.request({
      type: 'roll.request',
      tableId: t.table.id,
      payload: { formula: 'nope(1)' },
    });
    expect(invalid).toMatchObject({
      type: 'error',
      payload: { code: 'invalid_formula', message: expect.stringContaining('nope') as unknown },
    });
    const eve = await openSocket(t.app, t.eve.client);
    const outsider = await eve.request({
      type: 'roll.request',
      tableId: t.table.id,
      payload: { formula: '1d6' },
    });
    expect(outsider).toMatchObject({ type: 'error', payload: { code: 'not_found' } });
    expect(Object.values(await totals(sockets)).flat()).toEqual([]);
  });
});
