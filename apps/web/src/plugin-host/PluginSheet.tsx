import { useMemo, type ComponentType, type ReactElement } from 'react';

import type { Value } from '@vtt/formula';
import type { SheetNode } from '@vtt/plugin-schema';
import {
  createMemoryStore,
  Sheet,
  useSheet,
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
import type { FrameSheet } from './frame-protocol.js';
import type { LoadedClient } from './load.js';
import { PluginFrame } from './PluginFrame.js';
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

/**
 * A plugin node in its sandboxed frame (ADR-074), with the SDK hooks fed from the sheet it
 * renders in (specs §8.10): the frame gets the data and derived values, and its writes go
 * through the sheet's store, which checks them.
 */
function bridge(
  name: string,
  client: LoadedClient,
  actor: FrameSheet['actor'],
): ComponentType<CustomNodeProps> {
  function Bridged({ props, rowPath }: CustomNodeProps): ReactElement {
    const { data, derived, readOnly, store } = useSheet();
    const rowKey = (rowPath ?? []).join('\u0000');
    const frameSheet = useMemo(
      (): FrameSheet => ({
        actor,
        readOnly,
        data,
        rowPath: rowKey === '' ? [] : rowKey.split('\u0000'),
        derived: derived.values,
      }),
      [data, derived.values, readOnly, rowKey],
    );
    const at = (path: string) => [...frameSheet.rowPath, ...path.split('.')];
    return (
      <PluginFrame
        code={client.frame}
        title={name}
        view={{ kind: 'node', name, props, sheet: frameSheet }}
        sheet={frameSheet}
        onSet={(path, value) => {
          if (!readOnly) store.set(at(path), value);
        }}
        onAdjust={(path, delta) => {
          if (!readOnly) store.adjust(at(path), delta);
        }}
      />
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
    if (!client) return {};
    const sheetActor = { id: actor.id, name: actor.name, type: actor.type };
    return Object.fromEntries(client.nodes.map((name) => [name, bridge(name, client, sheetActor)]));
  }, [client, actor.id, actor.name, actor.type]);

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
