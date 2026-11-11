import type { ActorType, FieldSchema, Status } from '@vtt/plugin-schema';

/** Whether a status's field, or an object on the way to it, is secret (specs §9.1). */
export function isSecretStatus(type: ActorType, status: Status): boolean {
  let field: FieldSchema | undefined = type.schema;
  for (const name of status.field.split('.')) {
    const properties: Record<string, FieldSchema> | undefined = field?.properties;
    field = properties && Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (field?.['x-layer'] === 'secret') return true;
  }
  return false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at a dot path of an actor's data, through objects only. */
function valueAt(data: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = data;
  for (const name of path.split('.')) {
    value = isRecord(value) && Object.hasOwn(value, name) ? value[name] : undefined;
  }
  return value;
}

/**
 * The statuses of an actor type that are on in `data` (T-1618), in the order the type lists
 * them: those whose field is `true`. Secret ones only with `secrets`, for GMs and assistants.
 */
export function activeStatuses(
  type: ActorType | undefined,
  data: Readonly<Record<string, unknown>>,
  { secrets }: { secrets: boolean },
): Status[] {
  if (!type?.statuses) return [];
  return type.statuses.filter(
    (status) => (secrets || !isSecretStatus(type, status)) && valueAt(data, status.field) === true,
  );
}
