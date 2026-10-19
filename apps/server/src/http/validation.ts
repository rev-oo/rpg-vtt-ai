import { z } from 'zod';

import { badRequest } from '../errors.js';

/** Validates untrusted input (body, params, query) at the HTTP boundary (specs §6.1). */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'validation_failed',
      'The request is invalid.',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,32}$/, '3–32 characters: letters, digits, "_", "." or "-".');

export const displayNameSchema = z.string().trim().min(1).max(64);
