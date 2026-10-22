import { useMemo, type ComponentType, type ReactElement } from 'react';

import type { Value } from '@vtt/formula';
import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';
import {
  ClientSheetContext,
  type ClientSheet,
  type NodeProps,
  type SheetActor,
} from '@vtt/sdk/client';
import {
  createMemoryStore,
  Sheet,
  useSheet,
  valueAt,
  type CustomNodeProps,
  type RollHandler,
  type SheetStrings,
} from '@vtt/sheet-renderer';
import { Alert } from '@vtt/ui';

import { t } from '../i18n/index.js';

import { PluginBoundary } from './PluginBoundary.js';
import type { TableSystem } from './system-context.js';

type ReadySystem = Extract<TableSystem, { status: 'ready' }>;

/** The renderer's words from the app catalogue (NFR-11). */
const strings = (): SheetStrings => ({
  addRow: t('sheet.addRow'),
  removeRow: t('sheet.removeRow'),
  moveUp: t('sheet.moveUp'),
  moveDown: t('sheet.moveDown'),
  decrease: t('sheet.decrease'),
  increase: t('sheet.increase'),
  noRows: t('sheet.noRows'),
  noImage: t('sheet.noImage'),
  missingNode: t('sheet.missingNode'),
  notNumber: t('validation.notNumber'),
  notInteger: t('validation.notInteger'),
  tooSmall: t('validation.tooSmallNumber'),
  tooBig: t('validation.tooBigNumber'),
  tooLong: t('validation.tooLong'),
});

/** A plugin node with the SDK hooks wired to the sheet it renders in (specs §8.10). */
function bridge(
  name: string,
  Node: ComponentType<NodeProps>,
  actor: SheetActor,
  translate: (text: string) => string,
): ComponentType<CustomNodeProps> {
  function Bridged({ props, rowPath }: CustomNodeProps): ReactElement {
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
        <PluginBoundary name={name}>
          <Node props={props} />
        </PluginBoundary>
      </ClientSheetContext.Provider>
    );
  }
  Bridged.displayName = `PluginNode(${name})`;
  return Bridged;
}

export interface PluginSheetProps {
  host: ReadySystem;
  actor: { id: string; name: string; type: string; system: Readonly<Record<string, unknown>> };
  kind: 'actor' | 'item';
  readOnly: boolean;
  /** GMs and assistants see secret fields (FR-SHEET-04). */
  secret: boolean;
  onRoll?: RollHandler | undefined;
}

/**
 * An entity's sheet from its system plugin (T-0409), with the plugin's texts, scoped CSS and
 * custom nodes. Until live sheets (M5) it shows the stored data in a memory store.
 */
export function PluginSheet({
  host,
  actor,
  kind,
  readOnly,
  secret,
  onRoll,
}: PluginSheetProps): ReactElement {
  const { system, rules, translate } = host;
  const { definition, client } = system;
  const types: Record<
    string,
    { schema: FieldSchema; derived?: Record<string, string> | undefined; sheet: string }
  > = kind === 'actor' ? definition.actorTypes : definition.itemTypes;
  const type = Object.hasOwn(types, actor.type) ? types[actor.type] : undefined;
  const layout: SheetNode | undefined = type && definition.sheets[type.sheet]?.layout;

  const store = useMemo(() => createMemoryStore(actor.system), [actor.system]);
  const nodes = useMemo(() => {
    const sheetActor = { id: actor.id, name: actor.name, type: actor.type };
    return Object.fromEntries(
      Object.entries(client?.nodes ?? {}).map(([name, node]) => [
        name,
        bridge(name, node, sheetActor, translate),
      ]),
    );
  }, [client, actor.id, actor.name, actor.type, translate]);

  if (!type || !layout) {
    return <Alert tone="error">{t('sheet.unknownType', { type: actor.type })}</Alert>;
  }
  return (
    <div className="flex flex-col gap-3">
      {system.clientError && (
        <Alert tone="error">{t('plugin.clientFailed', { detail: system.clientError })}</Alert>
      )}
      <Sheet
        pluginId={system.id}
        layout={layout}
        type={type}
        store={store}
        settings={rules.settings}
        readOnly={readOnly}
        secret={secret}
        translate={translate}
        strings={strings()}
        nodes={nodes}
        {...(onRoll && { onRoll })}
      />
    </div>
  );
}
