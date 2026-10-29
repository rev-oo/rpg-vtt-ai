import { useMemo, type ComponentType, type ReactElement } from 'react';

import type { Value } from '@vtt/formula';
import type { SheetNode } from '@vtt/plugin-schema';
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
  type ImagePicker,
  type ItemsRenderer,
  type RichTextRenderer,
  type RollHandler,
  type SheetPresence,
  type SheetStore,
  type SheetStrings,
} from '@vtt/sheet-renderer';
import { Alert } from '@vtt/ui';

import { t } from '../i18n/index.js';

import { entityType } from './entity-type.js';
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
  chooseImage: t('image.choose'),
  changeImage: t('image.change'),
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
  /** The live data (M5); without it the sheet shows the stored data in a memory store. */
  store?: SheetStore | undefined;
  /** Other viewers' focus on a live sheet (FR-SHEET-02). */
  presence?: SheetPresence | undefined;
  /** The editor of `richText` fields on a live sheet (ADR-037). */
  renderRichText?: RichTextRenderer | undefined;
  onRoll?: RollHandler | undefined;
  /** An actor's item totals (`@items`) and its `items` nodes (ADR-063). */
  itemTotals?: Readonly<Record<string, Value>> | undefined;
  renderItems?: ItemsRenderer | undefined;
  /** Sets `image` fields through the image picker, on a live sheet (ADR-065). */
  pickImage?: ImagePicker | undefined;
}

/**
 * An entity's sheet from its system plugin (T-0409), with the plugin's texts, scoped CSS and
 * custom nodes, over the live store when there is one.
 */
export function PluginSheet({
  host,
  actor,
  kind,
  readOnly,
  secret,
  store: live,
  presence,
  renderRichText,
  onRoll,
  itemTotals,
  renderItems,
  pickImage,
}: PluginSheetProps): ReactElement {
  const { system, rules, translate } = host;
  const { definition, client } = system;
  const type = entityType(definition, kind, actor.type);
  const layout: SheetNode | undefined = type && definition.sheets[type.sheet]?.layout;

  const stored = useMemo(() => createMemoryStore(actor.system), [actor.system]);
  const store = live ?? stored;
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
      {system.sharedError && (
        <Alert tone="error">{t('plugin.sharedFailed', { detail: system.sharedError })}</Alert>
      )}
      <Sheet
        pluginId={system.id}
        layout={layout}
        type={type}
        store={store}
        settings={rules.settings}
        functions={system.functions}
        readOnly={readOnly}
        secret={secret}
        translate={translate}
        strings={strings()}
        nodes={nodes}
        {...(presence && { presence })}
        {...(renderRichText && { renderRichText })}
        {...(onRoll && { onRoll })}
        {...(itemTotals && { itemTotals })}
        {...(renderItems && { renderItems })}
        {...(pickImage && { pickImage })}
      />
    </div>
  );
}
