import type { ComponentType, ReactElement } from 'react';

import type { Value } from '@vtt/formula';
import {
  ClientSheetContext,
  type ClientSheet,
  type NodeProps,
  type SheetActor,
} from '@vtt/sdk/client';
import { useSheet, valueAt, type CustomNodeProps } from '@vtt/sheet-renderer';

/** A plugin node with the SDK hooks wired to the sheet it renders in, as in the app. */
export function bridge(
  Node: ComponentType<NodeProps>,
  actor: SheetActor,
  translate: (text: string) => string,
): ComponentType<CustomNodeProps> {
  return function Bridged({ props, rowPath }: CustomNodeProps): ReactElement {
    const sheet = useSheet();
    const at = (path: string) => [...(rowPath ?? []), ...path.split('.')];
    const client: ClientSheet = {
      actor,
      readOnly: sheet.readOnly,
      get: (path) => valueAt(sheet.data, at(path)),
      set: (path, value) => {
        sheet.store.set(at(path), value);
      },
      adjust: (path, delta) => {
        sheet.store.adjust(at(path), delta);
      },
      derived: (key): Value | undefined =>
        Object.hasOwn(sheet.derived.values, key) ? sheet.derived.values[key] : undefined,
      translate,
    };
    return (
      <ClientSheetContext.Provider value={client}>
        <Node props={props} />
      </ClientSheetContext.Provider>
    );
  };
}
