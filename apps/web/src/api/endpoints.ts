import { request, requestNoContent } from './client.js';
import {
  sessionSchema,
  setupStatusSchema,
  systemsResponseSchema,
  tableResponseSchema,
  tablesResponseSchema,
  userResponseSchema,
  type GameSystem,
  type GameTable,
  type PublicUser,
  type Session,
} from './schemas.js';

export interface Credentials {
  username: string;
  password: string;
}

export const api = {
  setupStatus: async (): Promise<boolean> =>
    (await request('GET', '/setup/status', setupStatusSchema)).needsSetup,

  setupAdmin: (input: Credentials & { displayName: string }): Promise<Session> =>
    request('POST', '/setup/admin', sessionSchema, input),

  login: (input: Credentials): Promise<Session> =>
    request('POST', '/auth/login', sessionSchema, input),

  logout: (): Promise<void> => requestNoContent('POST', '/auth/logout'),

  me: (): Promise<Session> => request('GET', '/me', sessionSchema),

  updateMe: async (input: { displayName: string }): Promise<PublicUser> =>
    (await request('PATCH', '/me', userResponseSchema, input)).user,

  changePassword: (input: { currentPassword: string; newPassword: string }): Promise<void> =>
    requestNoContent('POST', '/me/password', input),

  listTables: async (): Promise<GameTable[]> =>
    (await request('GET', '/tables', tablesResponseSchema)).tables,

  createTable: async (input: {
    name: string;
    description: string;
    systemId: string;
  }): Promise<GameTable> => (await request('POST', '/tables', tableResponseSchema, input)).table,

  listSystems: async (): Promise<GameSystem[]> =>
    (await request('GET', '/systems', systemsResponseSchema)).systems,
};
