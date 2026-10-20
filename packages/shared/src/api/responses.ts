import { z } from 'zod';

import { TABLE_ROLES } from '../roles.js';

// Response bodies of the HTTP API. The server builds them with these types; the web validates
// them like any external input (specs §17).

export const publicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const sessionSchema = z.object({ user: publicUserSchema, csrfToken: z.string() });
export type Session = z.infer<typeof sessionSchema>;

export const setupStatusSchema = z.object({ needsSetup: z.boolean() });

export const userResponseSchema = z.object({ user: publicUserSchema });

/** The table fields members may see, plus the caller's own role. */
export const tableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemId: z.string(),
  /** The plugin's display name, or its id if the plugin is no longer installed. */
  systemName: z.string(),
  systemVersion: z.string(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  role: z.enum(TABLE_ROLES),
});
export type TableView = z.infer<typeof tableSchema>;

export const tablesResponseSchema = z.object({ tables: z.array(tableSchema) });
export const tableResponseSchema = z.object({ table: tableSchema });

export const systemSchema = z.object({ id: z.string(), name: z.string(), version: z.string() });
export type GameSystem = z.infer<typeof systemSchema>;
export const systemsResponseSchema = z.object({ systems: z.array(systemSchema) });

/** Every error is rendered as this envelope (specs §10.1). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
