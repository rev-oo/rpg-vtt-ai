import { compare, gt, lte, valid } from 'semver';
import { z } from 'zod';

import { IDENTIFIER, name, schemaUrl } from './common.js';

// Plugin data migrations (FR-PLUGIN-12, ADR-072): `migrations/<version>.json` holds the steps
// that bring an entity's data up to that version of the plugin.

/** The most steps one migration file may hold. */
export const MAX_MIGRATION_STEPS = 200;

/**
 * `stats.hp`, or `inventory.*.weight` for a field of every row of a collection: field names
 * joined by dots, with `*` only between two names.
 */
export const MIGRATION_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.\*)*\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const path = z
  .string()
  .regex(MIGRATION_PATH)
  .meta({ title: 'Field path' })
  .describe(
    'Field names joined by dots, such as `stats.hp`. `*` stands for every row of a collection: `inventory.*.weight`.',
  );

const target = {
  kind: z.enum(['actor', 'item']).describe('Whether the step changes actors or items.'),
  type: name.describe('The actor or item type whose data the step changes.'),
};

const renameStep = z
  .strictObject({
    op: z.literal('rename'),
    ...target,
    path,
    to: z
      .string()
      .regex(IDENTIFIER)
      .describe(
        'The field’s new name; it stays where it is: `stats.hp` to `health` gives `stats.health`.',
      ),
  })
  .describe('Renames a field in place.')
  .meta({ title: 'Rename step' });

const moveStep = z
  .strictObject({
    op: z.literal('move'),
    ...target,
    path,
    to: path.describe(
      'Where the value goes. Objects on the way are created. A `*` row stays the same row: `inventory.*.wt` can move to `inventory.*.weight`, not out of the row.',
    ),
  })
  .describe('Moves a field’s value to another path.')
  .meta({ title: 'Move step' });

const setDefaultStep = z
  .strictObject({
    op: z.literal('setDefault'),
    ...target,
    path,
    value: z.unknown().describe('The value it gets; it must fit the field.'),
  })
  .describe(
    'Gives a field a value where the entity has none, such as an existing entity’s value for a new field whose default is meant for new ones.',
  )
  .meta({ title: 'Set default step' });

const dropStep = z
  .strictObject({ op: z.literal('drop'), ...target, path })
  .describe('Removes a field and its value.')
  .meta({ title: 'Drop step' });

export const migrationStepSchema = z
  .discriminatedUnion('op', [renameStep, moveStep, setDefaultStep, dropStep])
  .describe(
    'One change to the data. A step whose field an entity does not have does nothing to it.',
  );
export type MigrationStep = z.infer<typeof migrationStepSchema>;

/** `migrations/<version>.json`: what brings data from the version before up to this one. */
export const migrationSchema = z
  .strictObject({
    ...schemaUrl,
    steps: z
      .array(migrationStepSchema)
      .max(MAX_MIGRATION_STEPS)
      .describe('Run in order, on each actor and item of the types they name.'),
  })
  .describe(
    'A data migration: steps that bring actors and items made with an older version up to the version the file is named after.',
  );
export type Migration = z.infer<typeof migrationSchema>;

/** Whether `version` is a version a migration file can be named after. */
export const isMigrationVersion = (version: string): boolean => valid(version) === version;

/**
 * The versions of `migrations` that bring data from `from` up to `to`, oldest first: those
 * after `from`, up to and including `to`. None when either is not a version or `to` is not
 * after `from`: migrations only run forwards (ADR-072).
 */
export function pendingMigrations(
  migrations: Readonly<Record<string, Migration>>,
  from: string,
  to: string,
): string[] {
  if (!isMigrationVersion(from) || !isMigrationVersion(to) || !gt(to, from)) return [];
  return Object.keys(migrations)
    .filter((version) => isMigrationVersion(version) && gt(version, from) && lte(version, to))
    .sort(compare);
}

/** Whether data stamped `from` is behind `to`, so an upgrade migrates it (ADR-072). */
export const isBehind = (from: string, to: string): boolean =>
  isMigrationVersion(from) && isMigrationVersion(to) && gt(to, from);
