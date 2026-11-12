import { useSystem } from '../../plugin-host/system-context.js';

/** Turns a type id into what players see. */
export type TypeLabel = (type: string) => string;

/**
 * The names of the system's actor and item types in the viewer's language (T-1620): a type's
 * `label`, or its id while the system loads or for a type it no longer declares.
 */
export function useTypeLabels(): { actor: TypeLabel; item: TypeLabel } {
  const system = useSystem();
  if (system.status !== 'ready') return { actor: (type) => type, item: (type) => type };
  const { actorTypes, itemTypes } = system.system.definition;
  const { translate } = system;
  return {
    actor: (type) =>
      Object.hasOwn(actorTypes, type) ? translate(actorTypes[type]?.label ?? type) : type,
    item: (type) =>
      Object.hasOwn(itemTypes, type) ? translate(itemTypes[type]?.label ?? type) : type,
  };
}
