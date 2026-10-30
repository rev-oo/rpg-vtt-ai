import {
  assetListResponseSchema,
  assetResponseSchema,
  type AssetView,
  type UpdateItemInput,
  acceptInviteResponseSchema,
  createdInviteResponseSchema,
  instanceInfoResponseSchema,
  instanceSettingsResponseSchema,
  invitePreviewResponseSchema,
  invitesResponseSchema,
  journalEntriesResponseSchema,
  journalEntryResponseSchema,
  memberUpdateResponseSchema,
  signupResponseSchema,
  type CreateInviteInput,
  type CreateJournalInput,
  type InstanceInfo,
  type InstanceSettings,
  type InvitePreview,
  type InviteView,
  type JournalEntryView,
  type JournalListQuery,
  type SignupInput,
  type SignupResponse,
  type UpdateInstanceSettingsInput,
  type UpdateJournalInput,
  type UpdateMemberInput,
  type UpdateTableInput,
  actorHistoryResponseSchema,
  actorResponseSchema,
  actorsResponseSchema,
  type ActorSnapshot,
  itemResponseSchema,
  itemsResponseSchema,
  tableTypesSchema,
  chatHistoryResponseSchema,
  chatMessageResponseSchema,
  membersResponseSchema,
  pluginResponseSchema,
  pluginsResponseSchema,
  sessionSchema,
  setupStatusSchema,
  systemDefinitionResponseSchema,
  systemsResponseSchema,
  tableResponseSchema,
  tablesResponseSchema,
  userResponseSchema,
  type ActorView,
  type AdminPlugin,
  type CreateActorInput,
  type CreateItemInput,
  type EntityListQuery,
  type ItemView,
  type TableTypes,
  type UpdateActorInput,
  type ChangePasswordInput,
  type ChatMessage,
  type ChatSendInput,
  type CombatantCreateInput,
  type CombatantUpdateInput,
  type CommandRequestInput,
  encounterResponseSchema,
  sceneListResponseSchema,
  sceneResponseSchema,
  tokenListResponseSchema,
  tokenResponseSchema,
  type TokenCreateInput,
  type TokenUpdateInput,
  type TokenView,
  type SceneCreateInput,
  type SceneUpdateInput,
  type SceneView,
  compendiumCopyResponseSchema,
  compendiumPageSchema,
  type CompendiumCopyInput,
  type CompendiumCopyResponse,
  type CompendiumEntry,
  type CompendiumPack,
  type CompendiumQuery,
  type EncounterView,
  type RollRequestInput,
  type CreateTableInput,
  type GameSystem,
  type SystemDefinition,
  type LoginInput,
  type MemberView,
  type PublicUser,
  type Session,
  type SetupAdminInput,
  type TableView,
  type UpdateMeInput,
} from '@vtt/shared/api';

import { request, requestNoContent, upload } from './client.js';

/** One page of a list, and the cursor of the next; `null` on the last (ADR-057). */
export interface ListPage<T> {
  rows: T[];
  nextCursor: string | null;
}

/** A change to the table's encounter, answered with the encounter as the caller sees it. */
async function encounterChange(
  tableId: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<EncounterView | null> {
  const url = `/tables/${tableId}/encounter${path}`;
  return (await request(method, url, encounterResponseSchema, body)).encounter;
}

export const api = {
  setupStatus: async (): Promise<boolean> =>
    (await request('GET', '/setup/status', setupStatusSchema)).needsSetup,

  setupAdmin: (input: SetupAdminInput): Promise<Session> =>
    request('POST', '/setup/admin', sessionSchema, input),

  login: (input: LoginInput): Promise<Session> =>
    request('POST', '/auth/login', sessionSchema, input),

  logout: (): Promise<void> => requestNoContent('POST', '/auth/logout'),

  me: (): Promise<Session> => request('GET', '/me', sessionSchema),

  updateMe: async (input: UpdateMeInput): Promise<PublicUser> =>
    (await request('PATCH', '/me', userResponseSchema, input)).user,

  changePassword: (input: ChangePasswordInput): Promise<void> =>
    requestNoContent('POST', '/me/password', input),

  listTables: async (): Promise<TableView[]> =>
    (await request('GET', '/tables', tablesResponseSchema)).tables,

  createTable: async (input: CreateTableInput): Promise<TableView> =>
    (await request('POST', '/tables', tableResponseSchema, input)).table,

  listSystems: async (): Promise<GameSystem[]> =>
    (await request('GET', '/systems', systemsResponseSchema)).systems,

  /** An available system's definition and asset URLs, for sheets and cards (T-0409). */
  getSystem: async (systemId: string): Promise<SystemDefinition> =>
    (
      await request(
        'GET',
        `/systems/${encodeURIComponent(systemId)}`,
        systemDefinitionResponseSchema,
      )
    ).system,
  getTable: async (tableId: string): Promise<TableView> =>
    (await request('GET', `/tables/${tableId}`, tableResponseSchema)).table,

  /** Name, description and house rules; GM only (FR-TABLE-07, FR-ADMIN-04). */
  updateTable: async (tableId: string, input: UpdateTableInput): Promise<TableView> =>
    (await request('PATCH', `/tables/${tableId}`, tableResponseSchema, input)).table,

  /** Archives the table, read-only for everyone, or unarchives it (FR-TABLE-06). */
  setTableArchived: async (tableId: string, archived: boolean): Promise<TableView> =>
    (
      await request(
        'POST',
        `/tables/${tableId}/${archived ? 'archive' : 'unarchive'}`,
        tableResponseSchema,
      )
    ).table,

  /** Moves the table to its system's installed version (ADR-058). */
  upgradeTableSystem: async (tableId: string): Promise<TableView> =>
    (await request('POST', `/tables/${tableId}/upgrade-system`, tableResponseSchema)).table,

  listMembers: async (tableId: string): Promise<MemberView[]> =>
    (await request('GET', `/tables/${tableId}/members`, membersResponseSchema)).members,

  /** A role (GM only) or the caller's own default character (FR-TABLE-04, 05). */
  updateMember: (tableId: string, userId: string, input: UpdateMemberInput): Promise<unknown> =>
    request('PATCH', `/tables/${tableId}/members/${userId}`, memberUpdateResponseSchema, input),

  /** Removes a member (GM), or leaves the table (anyone, for themselves). */
  removeMember: (tableId: string, userId: string): Promise<void> =>
    requestNoContent('DELETE', `/tables/${tableId}/members/${userId}`),

  listInvites: async (tableId: string): Promise<InviteView[]> =>
    (await request('GET', `/tables/${tableId}/invites`, invitesResponseSchema)).invites,

  /** The link is only shown once: the server keeps a hash of its token (FR-TABLE-03). */
  createInvite: (
    tableId: string,
    input: CreateInviteInput,
  ): Promise<{ invite: InviteView; url: string }> =>
    request('POST', `/tables/${tableId}/invites`, createdInviteResponseSchema, input),

  revokeInvite: (tableId: string, inviteId: string): Promise<void> =>
    requestNoContent('DELETE', `/tables/${tableId}/invites/${inviteId}`),

  previewInvite: async (token: string): Promise<InvitePreview> =>
    (await request('GET', `/invites/${token}`, invitePreviewResponseSchema)).invite,

  acceptInvite: async (token: string): Promise<TableView> =>
    (await request('POST', `/invites/${token}/accept`, acceptInviteResponseSchema)).table,

  /** A new account that joins the invite's table, signed in (FR-ADMIN-01). */
  signup: (token: string, input: SignupInput): Promise<SignupResponse> =>
    request('POST', `/invites/${token}/signup`, signupResponseSchema, input),

  listJournal: async (tableId: string, query: JournalListQuery = {}): Promise<JournalEntryView[]> =>
    (
      await request(
        'GET',
        `/tables/${tableId}/journal${toQuery(query)}`,
        journalEntriesResponseSchema,
      )
    ).entries,

  /** One page of the journal tab (§10.1, ADR-057). */
  journalPage: (tableId: string, query: JournalListQuery): Promise<ListPage<JournalEntryView>> =>
    request(
      'GET',
      `/tables/${tableId}/journal${toQuery(query)}`,
      journalEntriesResponseSchema,
    ).then(({ entries, nextCursor }) => ({ rows: entries, nextCursor })),

  getJournalEntry: async (entryId: string): Promise<JournalEntryView> =>
    (await request('GET', `/journal/${entryId}`, journalEntryResponseSchema)).entry,

  createJournalEntry: async (
    tableId: string,
    input: CreateJournalInput,
  ): Promise<JournalEntryView> =>
    (await request('POST', `/tables/${tableId}/journal`, journalEntryResponseSchema, input)).entry,

  updateJournalEntry: async (
    entryId: string,
    input: UpdateJournalInput,
  ): Promise<JournalEntryView> =>
    (await request('PATCH', `/journal/${entryId}`, journalEntryResponseSchema, input)).entry,

  deleteJournalEntry: (entryId: string): Promise<void> =>
    requestNoContent('DELETE', `/journal/${entryId}`),

  restoreJournalEntry: async (entryId: string): Promise<JournalEntryView> =>
    (await request('POST', `/journal/${entryId}/restore`, journalEntryResponseSchema)).entry,

  listTypes: (tableId: string): Promise<TableTypes> =>
    request('GET', `/tables/${tableId}/types`, tableTypesSchema),

  listActors: async (tableId: string, query: EntityListQuery = {}): Promise<ActorView[]> =>
    (await request('GET', `/tables/${tableId}/actors${toQuery(query)}`, actorsResponseSchema))
      .actors,

  /** One page of the actors tab (§10.1, ADR-057); `listActors` reads the whole list. */
  actorsPage: (tableId: string, query: EntityListQuery): Promise<ListPage<ActorView>> =>
    request('GET', `/tables/${tableId}/actors${toQuery(query)}`, actorsResponseSchema).then(
      ({ actors, nextCursor }) => ({ rows: actors, nextCursor }),
    ),

  createActor: async (tableId: string, input: CreateActorInput): Promise<ActorView> =>
    (await request('POST', `/tables/${tableId}/actors`, actorResponseSchema, input)).actor,

  updateActor: async (actorId: string, input: UpdateActorInput): Promise<ActorView> =>
    (await request('PATCH', `/actors/${actorId}`, actorResponseSchema, input)).actor,

  duplicateActor: async (actorId: string): Promise<ActorView> =>
    (await request('POST', `/actors/${actorId}/duplicate`, actorResponseSchema)).actor,

  deleteActor: (actorId: string): Promise<void> => requestNoContent('DELETE', `/actors/${actorId}`),

  restoreActor: async (actorId: string): Promise<ActorView> =>
    (await request('POST', `/actors/${actorId}/restore`, actorResponseSchema)).actor,

  /** The table's item library (items no actor owns). */
  listItems: async (tableId: string, query: EntityListQuery = {}): Promise<ItemView[]> =>
    (await request('GET', `/tables/${tableId}/items${toQuery(query)}`, itemsResponseSchema)).items,

  /** One page of the items tab (§10.1, ADR-057). */
  itemsPage: (tableId: string, query: EntityListQuery): Promise<ListPage<ItemView>> =>
    request('GET', `/tables/${tableId}/items${toQuery(query)}`, itemsResponseSchema).then(
      ({ items, nextCursor }) => ({ rows: items, nextCursor }),
    ),

  listActorItems: async (actorId: string): Promise<ItemView[]> =>
    (await request('GET', `/actors/${actorId}/items`, itemsResponseSchema)).items,

  createItem: async (tableId: string, input: CreateItemInput): Promise<ItemView> =>
    (await request('POST', `/tables/${tableId}/items`, itemResponseSchema, input)).item,

  /** Copies a library item into an actor (FR-ENT-05). */
  copyItemToActor: async (actorId: string, itemId: string): Promise<ItemView> =>
    (await request('POST', `/actors/${actorId}/items`, itemResponseSchema, { itemId })).item,

  /** One item, from the library or an actor (ADR-062). */
  getItem: async (itemId: string): Promise<ItemView> =>
    (await request('GET', `/items/${itemId}`, itemResponseSchema)).item,
  deleteItem: (itemId: string): Promise<void> => requestNoContent('DELETE', `/items/${itemId}`),

  restoreItem: async (itemId: string): Promise<ItemView> =>
    (await request('POST', `/items/${itemId}/restore`, itemResponseSchema)).item,

  updateItem: async (itemId: string, input: UpdateItemInput): Promise<ItemView> =>
    (await request('PATCH', `/items/${itemId}`, itemResponseSchema, input)).item,

  /** A table's images, newest first (FR-ASSET-01, ADR-064). */
  listAssets: async (tableId: string): Promise<AssetView[]> =>
    (await request('GET', `/tables/${tableId}/assets`, assetListResponseSchema)).assets,

  /** Uploads an image as the raw body; the server tells its type from its bytes. */
  uploadAsset: async (tableId: string, file: File): Promise<AssetView> =>
    (
      await upload(
        `/tables/${tableId}/assets?name=${encodeURIComponent(file.name)}`,
        assetResponseSchema,
        file,
        file.type.startsWith('image/') ? file.type : 'application/octet-stream',
      )
    ).asset,

  /** Deletes an image nothing uses; `409 asset_in_use` lists the uses (ADR-065). */
  deleteAsset: (assetId: string): Promise<void> => requestNoContent('DELETE', `/assets/${assetId}`),

  /** One page of chat, newest first; pass `before` (a previous `nextCursor`) for older ones. */
  chatHistory: (
    tableId: string,
    before?: string,
  ): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> =>
    request(
      'GET',
      `/tables/${tableId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      chatHistoryResponseSchema,
    ),

  sendChat: async (tableId: string, input: ChatSendInput): Promise<ChatMessage> =>
    (await request('POST', `/tables/${tableId}/messages`, chatMessageResponseSchema, input))
      .message,
  /** The author's new text (FR-CHAT-09). */
  editChat: async (messageId: string, text: string): Promise<ChatMessage> =>
    (await request('PATCH', `/messages/${messageId}`, chatMessageResponseSchema, { text })).message,
  deleteChat: (messageId: string): Promise<void> =>
    requestNoContent('DELETE', `/messages/${messageId}`),
  /** The actor's sheet history the caller may restore, newest first (FR-SHEET-11). */
  actorHistory: async (actorId: string): Promise<ActorSnapshot[]> =>
    (await request('GET', `/actors/${actorId}/history`, actorHistoryResponseSchema)).snapshots,
  restoreSnapshot: (actorId: string, snapshotId: string): Promise<void> =>
    requestNoContent('POST', `/actors/${actorId}/history/${snapshotId}/restore`),
  /** One page of the compendium's entries, and the system's packs (FR-PLUGIN-09). */
  compendiumPage: (
    tableId: string,
    query: CompendiumQuery,
  ): Promise<ListPage<CompendiumEntry> & { packs: CompendiumPack[] }> =>
    request('GET', `/tables/${tableId}/compendium${toQuery(query)}`, compendiumPageSchema).then(
      ({ entries, nextCursor, packs }) => ({ rows: entries, nextCursor, packs }),
    ),
  copyFromCompendium: (
    tableId: string,
    input: CompendiumCopyInput,
  ): Promise<CompendiumCopyResponse> =>
    request('POST', `/tables/${tableId}/compendium/copy`, compendiumCopyResponseSchema, input),

  /** The table's encounter as the caller may see it, or `null` (FR-COMBAT-01, 04). */
  getEncounter: async (tableId: string): Promise<EncounterView | null> =>
    (await request('GET', `/tables/${tableId}/encounter`, encounterResponseSchema)).encounter,

  /** Combat changes for GMs and assistants; each answers with the encounter (ADR-049). */
  createEncounter: (tableId: string): Promise<EncounterView | null> =>
    encounterChange(tableId, 'POST', ''),
  endEncounter: (tableId: string): Promise<void> =>
    requestNoContent('DELETE', `/tables/${tableId}/encounter`),
  addCombatant: (tableId: string, input: CombatantCreateInput): Promise<EncounterView | null> =>
    encounterChange(tableId, 'POST', '/combatants', input),
  updateCombatant: (
    tableId: string,
    combatantId: string,
    input: CombatantUpdateInput,
  ): Promise<EncounterView | null> =>
    encounterChange(tableId, 'PATCH', `/combatants/${combatantId}`, input),
  removeCombatant: (tableId: string, combatantId: string): Promise<EncounterView | null> =>
    encounterChange(tableId, 'DELETE', `/combatants/${combatantId}`),
  /** Rolls the system's initiative for those without one (FR-COMBAT-02). */
  rollInitiative: (tableId: string): Promise<EncounterView | null> =>
    encounterChange(tableId, 'POST', '/initiative', {}),
  startEncounter: (tableId: string): Promise<EncounterView | null> =>
    encounterChange(tableId, 'POST', '/start'),
  moveTurn: (tableId: string, direction: 'next' | 'previous'): Promise<EncounterView | null> =>
    encounterChange(tableId, 'POST', '/turn', { direction }),

  /** The scenes the caller sees: all of them for GMs and assistants, else the active one. */
  listScenes: async (tableId: string): Promise<SceneView[]> =>
    (await request('GET', `/tables/${tableId}/scenes`, sceneListResponseSchema)).scenes,
  /** Scene changes for GMs and assistants (FR-MAP-01, ADR-066). */
  createScene: async (tableId: string, input: SceneCreateInput): Promise<SceneView> =>
    (await request('POST', `/tables/${tableId}/scenes`, sceneResponseSchema, input)).scene,
  updateScene: async (sceneId: string, input: SceneUpdateInput): Promise<SceneView> =>
    (await request('PATCH', `/scenes/${sceneId}`, sceneResponseSchema, input)).scene,
  deleteScene: (sceneId: string): Promise<void> => requestNoContent('DELETE', `/scenes/${sceneId}`),
  /** Puts every scene of the table in the given order; answers with the list. */
  orderScenes: async (tableId: string, sceneIds: readonly string[]): Promise<SceneView[]> =>
    (
      await request('POST', `/tables/${tableId}/scenes/order`, sceneListResponseSchema, {
        sceneIds,
      })
    ).scenes,
  /** Shows a scene to players, or none; answers with the list. */
  setActiveScene: async (tableId: string, sceneId: string | null): Promise<SceneView[]> =>
    (
      await request('POST', `/tables/${tableId}/scenes/active`, sceneListResponseSchema, {
        sceneId,
      })
    ).scenes,

  /** A scene's tokens the caller may see (FR-MAP-03, ADR-068). */
  listTokens: async (sceneId: string): Promise<TokenView[]> =>
    (await request('GET', `/scenes/${sceneId}/tokens`, tokenListResponseSchema)).tokens,
  createToken: async (sceneId: string, input: TokenCreateInput): Promise<TokenView> =>
    (await request('POST', `/scenes/${sceneId}/tokens`, tokenResponseSchema, input)).token,
  /** Owners move their tokens; GMs and assistants also hide them. */
  updateToken: async (tokenId: string, input: TokenUpdateInput): Promise<TokenView> =>
    (await request('PATCH', `/tokens/${tokenId}`, tokenResponseSchema, input)).token,
  deleteToken: (tokenId: string): Promise<void> => requestNoContent('DELETE', `/tokens/${tokenId}`),

  /** Runs a slash command of the table's system; it answers like a roll (FR-PLUGIN-10). */
  command: async (tableId: string, input: CommandRequestInput): Promise<ChatMessage> =>
    (await request('POST', `/tables/${tableId}/commands`, chatMessageResponseSchema, input))
      .message,

  /** Rolls a typed formula; the result arrives as a roll message (FR-CHAT-03, 08). */
  roll: async (tableId: string, input: RollRequestInput): Promise<ChatMessage> =>
    (await request('POST', `/tables/${tableId}/rolls`, chatMessageResponseSchema, input)).message,

  /** Installed plugins, for admins (FR-ADMIN-02). */
  listPlugins: async (): Promise<AdminPlugin[]> =>
    (await request('GET', '/plugins', pluginsResponseSchema)).plugins,

  rescanPlugins: async (): Promise<AdminPlugin[]> =>
    (await request('POST', '/plugins/rescan', pluginsResponseSchema)).plugins,

  /** A plugin with code needs `acknowledgeCode` (FR-PLUGIN-06). */
  enablePlugin: async (id: string, acknowledgeCode = false): Promise<AdminPlugin> =>
    (
      await request('POST', `/plugins/${id}/enable`, pluginResponseSchema, {
        ...(acknowledgeCode && { acknowledgeCode }),
      })
    ).plugin,

  /** Installs a `.vttplugin` archive; `replace` lets it replace the same plugin (ADR-026). */
  installPlugin: async (file: Blob, replace = false): Promise<AdminPlugin> =>
    (
      await upload(
        `/plugins/install${replace ? '?replace=true' : ''}`,
        pluginResponseSchema,
        file,
        'application/zip',
      )
    ).plugin,

  disablePlugin: async (id: string): Promise<AdminPlugin> =>
    (await request('POST', `/plugins/${id}/disable`, pluginResponseSchema)).plugin,

  /** The site name and registration policy; needs no session. */
  instanceInfo: async (): Promise<InstanceInfo> =>
    (await request('GET', '/instance', instanceInfoResponseSchema)).instance,

  /** Instance settings, for admins (FR-ADMIN-01). */
  getInstanceSettings: async (): Promise<InstanceSettings> =>
    (await request('GET', '/admin/settings', instanceSettingsResponseSchema)).settings,

  updateInstanceSettings: async (input: UpdateInstanceSettingsInput): Promise<InstanceSettings> =>
    (await request('PATCH', '/admin/settings', instanceSettingsResponseSchema, input)).settings,
};

function toQuery(query: EntityListQuery | JournalListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'number') params.set(key, String(value));
    else if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
