import {
  actorResponseSchema,
  actorsResponseSchema,
  itemResponseSchema,
  itemsResponseSchema,
  tableTypesSchema,
  chatHistoryResponseSchema,
  chatMessageResponseSchema,
  membersResponseSchema,
  sessionSchema,
  setupStatusSchema,
  systemsResponseSchema,
  tableResponseSchema,
  tablesResponseSchema,
  userResponseSchema,
  type ActorView,
  type CreateActorInput,
  type CreateItemInput,
  type EntityListQuery,
  type ItemView,
  type TableTypes,
  type UpdateActorInput,
  type ChangePasswordInput,
  type ChatMessage,
  type ChatSendInput,
  type CreateTableInput,
  type GameSystem,
  type LoginInput,
  type MemberView,
  type PublicUser,
  type Session,
  type SetupAdminInput,
  type TableView,
  type UpdateMeInput,
} from '@vtt/shared/api';

import { request, requestNoContent } from './client.js';

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

  getTable: async (tableId: string): Promise<TableView> =>
    (await request('GET', `/tables/${tableId}`, tableResponseSchema)).table,

  listMembers: async (tableId: string): Promise<MemberView[]> =>
    (await request('GET', `/tables/${tableId}/members`, membersResponseSchema)).members,

  listTypes: (tableId: string): Promise<TableTypes> =>
    request('GET', `/tables/${tableId}/types`, tableTypesSchema),

  listActors: async (tableId: string, query: EntityListQuery = {}): Promise<ActorView[]> =>
    (await request('GET', `/tables/${tableId}/actors${toQuery(query)}`, actorsResponseSchema))
      .actors,

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

  listActorItems: async (actorId: string): Promise<ItemView[]> =>
    (await request('GET', `/actors/${actorId}/items`, itemsResponseSchema)).items,

  createItem: async (tableId: string, input: CreateItemInput): Promise<ItemView> =>
    (await request('POST', `/tables/${tableId}/items`, itemResponseSchema, input)).item,

  /** Copies a library item into an actor (FR-ENT-05). */
  copyItemToActor: async (actorId: string, itemId: string): Promise<ItemView> =>
    (await request('POST', `/actors/${actorId}/items`, itemResponseSchema, { itemId })).item,

  deleteItem: (itemId: string): Promise<void> => requestNoContent('DELETE', `/items/${itemId}`),

  restoreItem: async (itemId: string): Promise<ItemView> =>
    (await request('POST', `/items/${itemId}/restore`, itemResponseSchema)).item,

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
};

function toQuery(query: EntityListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}
