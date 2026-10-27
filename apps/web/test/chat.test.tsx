import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE, USER } from './support/fake-api.js';
import { fakeWebSocket, serverEvent, type FakeSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { BOB, HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

let seq = 0;
function message(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  seq += 1;
  return {
    id: `m${String(seq)}`,
    tableId: TABLE.id,
    senderId: BOB.userId,
    speaker: { name: 'Bob', actorId: null, imageUrl: null },
    audience: 'public',
    recipientIds: [],
    kind: 'text',
    text,
    rolls: [],
    card: null,
    createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0, seq)).toISOString(),
    ...extra,
  };
}

/** Newest first, as the API returns history. */
function page(messages: ChatMessage[], nextCursor: string | null = null) {
  return { body: { messages: [...messages].reverse(), nextCursor } };
}

function openTable({
  role = 'gm',
  history = page([]),
  handlers = {},
}: {
  role?: string;
  history?: ReturnType<typeof page>;
  handlers?: Parameters<typeof fakeApi>[0];
} = {}) {
  const sockets = fakeWebSocket();
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role } } },
    'GET /tables/t1/members': {
      body: { members: MEMBERS.map((m) => (m.userId === USER.id ? { ...m, role } : m)) },
    },
    'GET /tables/t1/actors': { body: { actors: [HERO] } },
    'GET /tables/t1/actors?trash=live': { body: { actors: [HERO] } },
    'GET /tables/t1/types': { body: TYPES },
    'GET /tables/t1/messages': history,
    ...handlers,
  });
  renderApp('/tables/t1');
  return { ...api, sockets };
}

/** The app's socket, once opened and subscribed to the table. */
async function connected(sockets: FakeSocket[]): Promise<FakeSocket> {
  await waitFor(() => {
    expect(sockets.length).toBeGreaterThan(0);
  });
  const socket = sockets.at(-1);
  if (!socket) throw new Error('no socket');
  socket.open();
  await waitFor(() => {
    expect(socket.sent).toContainEqual({ v: 1, type: 'subscribe', tableId: 't1' });
  });
  return socket;
}

const log = () => screen.getByRole('log', { name: 'Messages' });
const texts = () =>
  within(log())
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent);

describe('table page', () => {
  it('shows the table with its chat history, oldest first', async () => {
    const hello = message('hello');
    const whisper = message('psst', { audience: 'whisper', recipientIds: [USER.id] });
    openTable({ history: page([hello, whisper, message('gm', { audience: 'gm' })]) });

    expect(await screen.findByRole('heading', { name: 'Crimson Throne' })).toBeInTheDocument();
    expect(texts()).toEqual(['hello', 'psst', 'gm']);
    const items = within(log()).getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('Whisper to Alice');
    expect(items[2]).toHaveTextContent('GM only');
  });

  it('links each table from the list', async () => {
    fakeWebSocket();
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [TABLE] } },
    });
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Crimson Throne' })).toHaveAttribute(
      'href',
      '/tables/t1',
    );
  });

  it('explains a table that cannot be opened', async () => {
    fakeWebSocket();
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables/t9': { status: 404, body: { error: { code: 'not_found', message: 'x' } } },
      'GET /tables/t9/members': {
        status: 404,
        body: { error: { code: 'not_found', message: 'x' } },
      },
      'GET /tables/t9/actors': {
        status: 404,
        body: { error: { code: 'not_found', message: 'x' } },
      },
      'GET /tables/t9/messages': {
        status: 404,
        body: { error: { code: 'not_found', message: 'x' } },
      },
    });
    renderApp('/tables/t9');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This table does not exist, or you are not a member.',
    );
  });
});

describe('sending messages (FR-CHAT-01, 02)', () => {
  it('posts a message and shows it once, even when the socket echoes it', async () => {
    const sent = message('Hello table', {
      senderId: USER.id,
      speaker: { name: 'Alice', actorId: null, imageUrl: null },
    });
    const { calls, sockets } = openTable({
      handlers: { 'POST /tables/t1/messages': { status: 201, body: { message: sent } } },
    });
    const socket = await connected(sockets);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Message'), 'Hello table{Enter}');
    await waitFor(() => {
      expect(texts()).toEqual(['Hello table']);
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      text: 'Hello table',
      audience: 'public',
      recipientIds: [],
      actorId: null,
    });
    expect(screen.getByLabelText('Message')).toHaveValue('');

    socket.receive(
      serverEvent({ type: 'chat.message', tableId: 't1', payload: { message: sent } }),
    );
    expect(texts()).toEqual(['Hello table']);
  });

  it('whispers to chosen members and speaks as an owned actor', async () => {
    const { calls } = openTable({
      handlers: {
        'POST /tables/t1/messages': { status: 201, body: { message: message('psst') } },
      },
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Speak as'), 'Goblin King');
    await user.selectOptions(screen.getByLabelText('Send to'), 'Whisper');

    await user.type(screen.getByLabelText('Message'), 'psst{Enter}');
    expect(await screen.findByText('Choose at least one recipient for the whisper.')).toBeVisible();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const recipients = screen.getByRole('group', { name: 'Recipients' });
    expect(within(recipients).queryByLabelText('Alice')).toBeNull();
    await user.click(within(recipients).getByLabelText('Bob'));
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        text: 'psst',
        audience: 'whisper',
        recipientIds: ['u2'],
        actorId: 'a1',
      });
    });
  });

  it('shows refused messages with a translated reason', async () => {
    openTable({
      handlers: {
        'POST /tables/t1/messages': {
          status: 422,
          body: { error: { code: 'invalid_speaker', message: 'server wording' } },
        },
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Message'), 'hi{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only speak as an actor you own.',
    );
    expect(screen.getByLabelText('Message')).toHaveValue('hi');
  });

  it('rolls dice commands on the server (FR-CHAT-03, 05, 08)', async () => {
    const rolled = (formula: string, total: number) =>
      message(formula, {
        senderId: USER.id,
        kind: 'roll',
        rolls: [{ expression: formula, resolved: formula, total, dice: [] }],
      });
    const { calls } = openTable({
      handlers: {
        'POST /tables/t1/rolls': (body) => {
          const { formula } = body as { formula: string };
          return { status: 201, body: { message: rolled(formula, 7) } };
        },
        'POST /tables/t1/messages': { status: 201, body: { message: message('/r is literal') } },
        'POST /tables/t1/commands': (body) =>
          (body as { name: string }).name === 'greet'
            ? { status: 201, body: { message: message('Ana greets you') } }
            : {
                status: 422,
                body: { error: { code: 'unknown_command', message: 'There is no command.' } },
              },
      },
    });
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Message');
    const posts = () => calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]);

    await user.type(input, '/gmr 1d20 + 2{Enter}');
    expect(await screen.findByLabelText('Total 7')).toBeVisible();
    expect(input).toHaveValue('');

    await user.type(input, '/r{Enter}');
    expect(await screen.findByText('Add a formula, e.g. /r 2d6+3.')).toBeVisible();
    await user.clear(input);
    await user.type(input, '/dance{Enter}');
    expect(await screen.findByText(/Unknown command \/dance/)).toBeVisible();

    // `/r` follows the chosen audience.
    await user.clear(input);
    await user.selectOptions(screen.getByLabelText('Send to'), 'Whisper');
    await user.click(
      within(screen.getByRole('group', { name: 'Recipients' })).getByLabelText('Bob'),
    );
    await user.type(input, '/r 2d6{Enter}');
    await user.selectOptions(screen.getByLabelText('Send to'), 'Everyone');
    await user.type(input, '//r is literal{Enter}');
    // Other commands are the table system's (FR-PLUGIN-10).
    await user.type(input, '/greet you{Enter}');
    expect(await screen.findByText('Ana greets you')).toBeVisible();

    await waitFor(() => {
      expect(posts()).toEqual([
        [
          '/tables/t1/rolls',
          { formula: '1d20 + 2', audience: 'gm', recipientIds: [], actorId: null },
        ],
        [
          '/tables/t1/commands',
          { name: 'dance', args: '', audience: 'public', recipientIds: [], actorId: null },
        ],
        [
          '/tables/t1/rolls',
          { formula: '2d6', audience: 'whisper', recipientIds: ['u2'], actorId: null },
        ],
        [
          '/tables/t1/messages',
          { text: '/r is literal', audience: 'public', recipientIds: [], actorId: null },
        ],
        [
          '/tables/t1/commands',
          { name: 'greet', args: 'you', audience: 'public', recipientIds: [], actorId: null },
        ],
      ]);
    });
  });

  it('shows why a formula cannot be rolled', async () => {
    openTable({
      handlers: {
        'POST /tables/t1/rolls': {
          status: 422,
          body: {
            error: {
              code: 'invalid_formula',
              message:
                'Unknown name "str"; references start with "@", as in @str (line 1, column 8)',
            },
          },
        },
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Message'), '/r 1d20 + str{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unknown name "str"; references start with "@", as in @str (line 1, column 8)',
    );
    expect(screen.getByLabelText('Message')).toHaveValue('/r 1d20 + str');
  });

  it('shows every die and the total of a roll (FR-DICE-04)', async () => {
    const roll = message('4d6kh3 + @mod', {
      kind: 'roll',
      audience: 'gm',
      rolls: [
        {
          expression: '4d6kh3 + @mod',
          resolved: '4d6kh3 + 2',
          total: 17,
          dice: [
            {
              formula: '4d6kh3',
              count: 4,
              die: 'd6',
              total: 15,
              results: [
                { value: 6, active: true, exploded: true },
                { value: 1, active: false, dropped: true },
                { value: 5, active: true },
                { value: 4, active: true },
              ],
            },
          ],
        },
      ],
    });
    openTable({ history: page([roll]) });
    expect(await screen.findByLabelText('Total 17')).toHaveTextContent('17');
    const item = within(log());
    expect(item.getByText('4d6kh3 + @mod')).toBeVisible();
    expect(item.getByText('→ 4d6kh3 + 2')).toBeVisible();
    const dice = screen.getByRole('list', { name: 'Dice of 4d6kh3' });
    expect(
      within(dice)
        .getAllByRole('listitem')
        .map((die) => die.title),
    ).toEqual(['6, exploded', '1, dropped', '5', '4']);
    expect(within(log()).getByText('GM only')).toBeVisible();
  });

  it('lets spectators read but not post', async () => {
    openTable({ role: 'spectator', history: page([message('hello')]) });
    expect(
      await screen.findByText('Spectators can read the chat but not post.'),
    ).toBeInTheDocument();
    expect(texts()).toEqual(['hello']);
    expect(screen.queryByLabelText('Message')).toBeNull();
  });
});

describe('live updates and history (FR-CHAT-07, §10.2)', () => {
  it('adds messages from the socket, only for this table', async () => {
    const { sockets } = openTable({ history: page([message('first')]) });
    const socket = await connected(sockets);

    socket.receive(
      serverEvent({ type: 'chat.message', tableId: 't1', payload: { message: message('live') } }),
    );
    socket.receive(
      serverEvent({
        type: 'chat.message',
        tableId: 't2',
        payload: { message: message('elsewhere', { tableId: 't2' }) },
      }),
    );
    socket.receive({ v: 1, type: 'not-a-known-event' });
    await waitFor(() => {
      expect(texts()).toEqual(['first', 'live']);
    });
  });

  it('loads older pages on demand', async () => {
    const older = [message('oldest'), message('older')];
    const newer = [message('newer'), message('newest')];
    const { calls } = openTable({
      history: page(newer, 'cursor-1'),
      handlers: { 'GET /tables/t1/messages?before=cursor-1': page(older) },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load older messages' }));

    await waitFor(() => {
      expect(texts()).toEqual(['oldest', 'older', 'newer', 'newest']);
    });
    expect(calls.filter((c) => c.path.startsWith('/tables/t1/messages'))).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
  });

  it('reconnects, subscribes again and catches up from history', async () => {
    const before = message('before');
    let history = page([before]);
    const { sockets } = openTable({
      handlers: { 'GET /tables/t1/messages': () => history },
    });
    expect(await screen.findByText('Connecting…')).toBeVisible();
    const socket = await connected(sockets);
    expect(texts()).toEqual(['before']);
    await waitFor(() => {
      expect(screen.queryByText('Connecting…')).toBeNull();
    });

    socket.drop();
    expect(await screen.findByText('Reconnecting…')).toBeVisible();
    history = page([before, message('missed while away')]);
    await waitFor(
      () => {
        expect(sockets).toHaveLength(2);
      },
      { timeout: 2000 },
    );
    const again = await connected(sockets);
    expect(again.sent).toContainEqual({ v: 1, type: 'subscribe', tableId: 't1' });
    await waitFor(() => {
      expect(texts()).toEqual(['before', 'missed while away']);
    });
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });

  it('stops when the server ends the session', async () => {
    const { sockets } = openTable();
    const socket = await connected(sockets);
    socket.drop(4401);
    expect(
      await screen.findByText('Your session ended. Log in again to keep chatting.'),
    ).toBeVisible();
  });
});
