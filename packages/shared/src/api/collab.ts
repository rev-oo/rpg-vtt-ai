import { z } from 'zod';

// Stateless messages on a `/ws/collab` document (specs §9.5, §9.7): JSON strings sent over the
// Hocuspocus stateless channel of the document they concern.

/** A field in a document's `data` map: map keys, and row ids inside collections. */
export const fieldPath = z.array(z.string().min(1).max(64)).min(1).max(8);
export type FieldPath = z.infer<typeof fieldPath>;

/** Why a value does not fit its field (specs §8.4). */
export const DATA_ISSUE_REASONS = [
  'type',
  'enum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
] as const;
export type DataIssueReason = (typeof DATA_ISSUE_REASONS)[number];

/** The largest delta one `adjust` may apply. */
export const MAX_ADJUST_DELTA = 1_000_000;

export const collabClientMessage = z.discriminatedUnion('type', [
  /** Adds `delta` to an `x-counter` field on the server's copy (FR-SHEET-08). */
  z.object({
    type: z.literal('adjust'),
    /** Correlates the server's answer. */
    id: z.string().min(1).max(64),
    path: fieldPath,
    delta: z.number().min(-MAX_ADJUST_DELTA).max(MAX_ADJUST_DELTA),
  }),
]);
export type CollabClientMessage = z.infer<typeof collabClientMessage>;

const dataIssue = z.object({ path: fieldPath, reason: z.enum(DATA_ISSUE_REASONS) });
export type DataIssue = z.infer<typeof dataIssue>;

export const collabServerMessage = z.discriminatedUnion('type', [
  /** The field's value after the delta; `clamped` when its bounds cut the delta short. */
  z.object({
    type: z.literal('adjusted'),
    id: z.string(),
    value: z.number(),
    clamped: z.boolean(),
  }),
  /** A message the server refused; `id` is null when it could not be read. */
  z.object({
    type: z.literal('error'),
    id: z.string().nullable(),
    code: z.enum(['invalid_message', 'read_only', 'not_a_counter']),
  }),
  /** Values the server replaced with their default before storing (FR-SHEET-09). */
  z.object({ type: z.literal('validation'), issues: z.array(dataIssue) }),
]);
export type CollabServerMessage = z.infer<typeof collabServerMessage>;
