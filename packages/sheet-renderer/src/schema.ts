import type { FieldSchema } from '@vtt/plugin-schema';

/** The schema of the field at a dot path (`hp.value`) below `parent`, or undefined. */
export function fieldAt(parent: FieldSchema | undefined, dotPath: string): FieldSchema | undefined {
  let field = parent;
  for (const name of dotPath.split('.')) {
    const properties = field?.properties;
    field = properties && Object.hasOwn(properties, name) ? properties[name] : undefined;
  }
  return field;
}

/** Whether the field, or a field it sits in, is on the secret layer (specs §8.4). */
export function isSecretPath(parent: FieldSchema | undefined, dotPath: string): boolean {
  let field = parent;
  for (const name of dotPath.split('.')) {
    const properties = field?.properties;
    field = properties && Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (field?.['x-layer'] === 'secret') return true;
  }
  return false;
}
