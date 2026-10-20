import { z } from 'zod';

import { t } from '../i18n/index.js';

// Client-side rules mirror the server's (apps/server http/validation.ts and routes); the
// server stays the authority and re-validates everything.

/** Mirrors the server's `MIN_PASSWORD_LENGTH`. */
export const MIN_PASSWORD_LENGTH = 8;

const required = (max: number) =>
  z.string().trim().min(1, t('validation.required')).max(max, t('validation.tooLong', { max }));

const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, t('validation.tooShort', { min: MIN_PASSWORD_LENGTH }))
  .max(256, t('validation.tooLong', { max: 256 }));

export const setupSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{3,32}$/, t('validation.username')),
  displayName: required(64),
  password: newPassword,
});

export const loginSchema = z.object({
  username: required(64),
  password: z.string().min(1, t('validation.required')),
});

export const profileSchema = z.object({ displayName: required(64) });

export const passwordSchema = z.object({
  currentPassword: z.string().min(1, t('validation.required')),
  newPassword,
});

export const createTableSchema = z.object({
  name: required(100),
  description: z
    .string()
    .trim()
    .max(2000, t('validation.tooLong', { max: 2000 })),
  systemId: z.string().min(1, t('validation.required')),
});
