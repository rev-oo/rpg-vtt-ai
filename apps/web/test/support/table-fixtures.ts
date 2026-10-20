import { TABLE, USER } from './fake-api.js';

// Members, an actor and the system types of `TABLE`, as the API returns them.

export const BOB = { userId: 'u2', username: 'bob', displayName: 'Bob', role: 'player' };
export const MEMBERS = [
  {
    userId: USER.id,
    username: USER.username,
    displayName: USER.displayName,
    role: 'gm',
    defaultCharacterId: null,
    joinedAt: '2026-10-19T00:00:00.000Z',
  },
  { ...BOB, defaultCharacterId: null, joinedAt: '2026-10-19T00:00:00.000Z' },
];
/** An NPC the signed-in GM owns. */
export const HERO = {
  id: 'a1',
  tableId: TABLE.id,
  type: 'npc',
  name: 'Goblin King',
  imageUrl: null,
  ownership: { default: 'none', users: {} },
  system: {},
  dataVersion: '1.0.0',
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  deletedAt: null,
  access: 'owner',
};

export const TYPES = {
  actorTypes: [
    { type: 'character', controlledBy: 'player' },
    { type: 'npc', controlledBy: 'gm' },
  ],
  itemTypes: ['weapon', 'consumable'],
};
