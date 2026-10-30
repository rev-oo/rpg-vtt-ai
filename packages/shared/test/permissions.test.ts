import { describe, expect, it } from 'vitest';

import {
  actorLayerAccess,
  AUDIENCES,
  canArchiveTable,
  canCreateActor,
  canCreateJournal,
  canEditActor,
  canEditJournal,
  canManageInvites,
  canManageItemLibrary,
  canManageMembers,
  canManageScenes,
  canMoveToken,
  canSeeToken,
  canManageTable,
  canSeeAudience,
  canSeeGmContent,
  canSetOwnership,
  canViewActor,
  canViewJournal,
  itemLayerAccess,
  DEFAULT_JOURNAL_OWNERSHIP,
  effectiveOwnership,
  journalAccess,
  OWNERSHIP_LEVELS,
  TABLE_ROLES,
  type Audience,
  type DocumentAccess,
  type Ownership,
  type OwnershipLevel,
  type Subject,
  type TableRole,
} from '../src/index.js';

const ME = 'user-me';
const OTHER = 'user-other';

/** Every ownership setting as seen by ME: each default × (no per-user entry | each level). */
const OWNERSHIPS: { label: string; ownership: Ownership; resolved: OwnershipLevel }[] =
  OWNERSHIP_LEVELS.flatMap((byDefault) => [
    {
      label: `default=${byDefault}`,
      ownership: { default: byDefault, users: { [OTHER]: 'owner' } },
      resolved: byDefault,
    },
    ...OWNERSHIP_LEVELS.map((mine) => ({
      label: `default=${byDefault}, me=${mine}`,
      ownership: { default: byDefault, users: { [ME]: mine } },
      resolved: mine,
    })),
  ]);

/** Effective level by role, given the level resolved from the ownership (FR-ENT-03). */
const EFFECTIVE: Record<TableRole, Record<OwnershipLevel, OwnershipLevel>> = {
  gm: { none: 'owner', observer: 'owner', owner: 'owner' },
  assistant: { none: 'owner', observer: 'owner', owner: 'owner' },
  player: { none: 'none', observer: 'observer', owner: 'owner' },
  spectator: { none: 'none', observer: 'observer', owner: 'observer' },
};

/** specs §9.3, column by effective level/role. */
const ACTOR_MAIN: Record<OwnershipLevel, DocumentAccess> = {
  none: 'none',
  observer: 'read',
  owner: 'write',
};
const SECRET_LAYER: Record<TableRole, DocumentAccess> = {
  gm: 'write',
  assistant: 'write',
  player: 'none',
  spectator: 'none',
};

const cases = TABLE_ROLES.flatMap((role) =>
  OWNERSHIPS.map(({ label, ownership, resolved }) => ({
    role,
    label,
    ownership,
    subject: { userId: ME, role } satisfies Subject,
    expected: EFFECTIVE[role][resolved],
  })),
);

describe('ownership (every role × ownership combination)', () => {
  it('covers 4 roles × 12 ownership settings', () => {
    expect(cases).toHaveLength(48);
  });

  it.each(cases)('$role with $label → $expected', ({ subject, ownership, expected }) => {
    expect(effectiveOwnership(subject, ownership)).toBe(expected);
  });
});

describe('actors (every role × ownership combination)', () => {
  it.each(cases)('$role with $label', ({ role, subject, ownership, expected }) => {
    expect(canViewActor(subject, ownership)).toBe(expected !== 'none');
    expect(canEditActor(subject, ownership)).toBe(expected === 'owner');
    expect(actorLayerAccess(subject, ownership, 'main')).toBe(ACTOR_MAIN[expected]);
    expect(actorLayerAccess(subject, ownership, 'secret')).toBe(SECRET_LAYER[role]);
    // An owned item's layers follow its actor (ADR-062).
    expect(itemLayerAccess(subject, ownership, 'main')).toBe(ACTOR_MAIN[expected]);
    expect(itemLayerAccess(subject, ownership, 'secret')).toBe(SECRET_LAYER[role]);
  });

  it.each(TABLE_ROLES)('library item layers for %s (ADR-062)', (role) => {
    const subject = { userId: 'u1', role };
    expect(itemLayerAccess(subject, undefined, 'main')).toBe(
      canManageItemLibrary(role) ? 'write' : 'read',
    );
    expect(itemLayerAccess(subject, undefined, 'secret')).toBe(SECRET_LAYER[role]);
  });

  const CREATE: Record<TableRole, [player: boolean, gm: boolean, gmAllowed: boolean]> = {
    gm: [true, true, true],
    assistant: [true, true, true],
    player: [true, false, true],
    spectator: [false, false, false],
  };
  it.each(TABLE_ROLES)('creation rules for %s (FR-ENT-01)', (role) => {
    const [playerType, gmType, gmTypeAllowed] = CREATE[role];
    expect(canCreateActor(role, 'player')).toBe(playerType);
    expect(canCreateActor(role, 'gm')).toBe(gmType);
    expect(canCreateActor(role, 'gm', true)).toBe(gmTypeAllowed);
  });
});

describe('journal (every role × ownership × hidden combination)', () => {
  it.each(cases)('$role with $label', ({ role, subject, ownership, expected }) => {
    const visible = { ownership, hidden: false };
    const hidden = { ownership, hidden: true };
    const visibleAccess = ACTOR_MAIN[expected];
    const hiddenAccess = SECRET_LAYER[role];

    expect(journalAccess(subject, visible)).toBe(visibleAccess);
    expect(canViewJournal(subject, visible)).toBe(visibleAccess !== 'none');
    expect(canEditJournal(subject, visible)).toBe(visibleAccess === 'write');
    expect(journalAccess(subject, hidden)).toBe(hiddenAccess);
    expect(canViewJournal(subject, hidden)).toBe(hiddenAccess !== 'none');
    expect(canEditJournal(subject, hidden)).toBe(hiddenAccess === 'write');
  });

  it('defaults to read-only for players (FR-JOURNAL-02)', () => {
    const entry = { ownership: DEFAULT_JOURNAL_OWNERSHIP, hidden: false };
    expect(journalAccess({ userId: ME, role: 'player' }, entry)).toBe('read');
  });

  it.each([
    ['gm', true],
    ['assistant', true],
    ['player', false],
    ['spectator', false],
  ] as const)('%s may create entries: %s (FR-JOURNAL-01)', (role, expected) => {
    expect(canCreateJournal(role)).toBe(expected);
  });
});

describe('chat audience (every role × audience × relation)', () => {
  type Relation = 'sender' | 'recipient' | 'bystander';
  const SEES: Record<Audience, Record<Relation, Record<TableRole, boolean>>> = {
    public: {
      sender: { gm: true, assistant: true, player: true, spectator: true },
      recipient: { gm: true, assistant: true, player: true, spectator: true },
      bystander: { gm: true, assistant: true, player: true, spectator: true },
    },
    // Whispers reach only the sender and recipients, not even the GM (specs §10.2).
    whisper: {
      sender: { gm: true, assistant: true, player: true, spectator: true },
      recipient: { gm: true, assistant: true, player: true, spectator: true },
      bystander: { gm: false, assistant: false, player: false, spectator: false },
    },
    // GM and assistants only; the sender still sees their own secret roll (FR-CHAT-05).
    gm: {
      sender: { gm: true, assistant: true, player: true, spectator: true },
      recipient: { gm: true, assistant: true, player: false, spectator: false },
      bystander: { gm: true, assistant: true, player: false, spectator: false },
    },
  };
  const RELATIONS: Relation[] = ['sender', 'recipient', 'bystander'];
  const audienceCases = AUDIENCES.flatMap((audience) =>
    RELATIONS.flatMap((relation) =>
      TABLE_ROLES.map((role) => ({
        audience,
        relation,
        role,
        expected: SEES[audience][relation][role],
      })),
    ),
  );

  it('covers 3 audiences × 3 relations × 4 roles', () => {
    expect(audienceCases).toHaveLength(36);
  });

  it.each(audienceCases)(
    '$audience to a $role $relation → $expected',
    ({ audience, relation, role, expected }) => {
      const message = {
        audience,
        senderId: relation === 'sender' ? ME : OTHER,
        recipientIds: relation === 'recipient' ? [ME] : ['user-third'],
      };
      expect(canSeeAudience({ userId: ME, role }, message)).toBe(expected);
    },
  );
});

describe('table-level permissions', () => {
  const TABLE: Record<TableRole, [manage: boolean, archive: boolean, gmContent: boolean]> = {
    gm: [true, true, true],
    assistant: [false, true, true],
    player: [false, false, false],
    spectator: [false, false, false],
  };
  it.each(TABLE_ROLES)('%s', (role) => {
    const [manage, archive, gmContent] = TABLE[role];
    expect(canManageTable(role)).toBe(manage);
    expect(canManageMembers(role)).toBe(manage);
    expect(canManageInvites(role)).toBe(manage);
    expect(canArchiveTable(role)).toBe(archive);
    expect(canSeeGmContent(role)).toBe(gmContent);
    // GM-like roles curate the item library and set ownership (FR-ENT-02, 05).
    expect(canManageItemLibrary(role)).toBe(gmContent);
    expect(canSetOwnership(role)).toBe(gmContent);
    // And prepare scenes (FR-MAP-01).
    expect(canManageScenes(role)).toBe(gmContent);
  });
});

describe('tokens (FR-MAP-03, ADR-068)', () => {
  const owned = { default: 'none', users: { [ME]: 'owner' } } as const;
  const watched = { default: 'observer', users: {} } as const;
  const shown = { hidden: false, sceneActive: true };

  it.each(TABLE_ROLES)('%s sees and moves what the role allows', (role) => {
    const gmLike = role === 'gm' || role === 'assistant';
    expect(canSeeToken(role, shown)).toBe(true);
    expect(canSeeToken(role, { hidden: true, sceneActive: true })).toBe(gmLike);
    expect(canSeeToken(role, { hidden: false, sceneActive: false })).toBe(gmLike);
    const subject = { userId: ME, role };
    // Owners move their actors' tokens; spectators own nothing.
    expect(canMoveToken(subject, { ...shown, actorOwnership: owned })).toBe(
      gmLike || role === 'player',
    );
    expect(canMoveToken(subject, { ...shown, actorOwnership: watched })).toBe(gmLike);
    expect(canMoveToken(subject, { ...shown, actorOwnership: null })).toBe(gmLike);
    expect(canMoveToken(subject, { hidden: true, sceneActive: true, actorOwnership: owned })).toBe(
      gmLike,
    );
  });
});
