import {
  actorsResponseSchema,
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

  listActors: async (tableId: string): Promise<ActorView[]> =>
    (await request('GET', `/tables/${tableId}/actors`, actorsResponseSchema)).actors,

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
