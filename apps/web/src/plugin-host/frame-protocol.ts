import { z } from 'zod';

import type { Value } from '@vtt/formula';
import type { TableEvent, Viewer } from '@vtt/sdk/client';
import { COMBAT_ACTIONS } from '@vtt/sdk/client';
import { chatSendBody, rollRequestBody } from '@vtt/shared/api';

// Messages between the app and a plugin frame (T-1502, ADR-074). Each custom node and card
// renders in its own sandboxed <iframe> with an opaque origin, so the app reaches it only by
// `postMessage`, and checks everything it receives like any external input.

/** The page each frame loads; the server sends it with the frame's own policy. */
export const FRAME_URL = '/plugin-frame.html';
/** The classic script the frame page runs: React, the SDK and the frame's half of the bridge. */
export const FRAME_SCRIPT_URL = '/plugin-frame.js';
/** The global the frame keeps React and the SDK on, for the modules plugin code imports. */
export const FRAME_RUNTIME_GLOBAL = '__VTT_PLUGIN_RUNTIME__';
/** The most a frame may grow, in CSS pixels. */
export const MAX_FRAME_HEIGHT = 4000;

/** The sheet a custom node renders in: what the SDK hooks read. */
export interface FrameSheet {
  actor: { id: string; name: string; type: string } | null;
  readOnly: boolean;
  /** The entity's data as this viewer sees it, and the node's row inside a list. */
  data: Readonly<Record<string, unknown>>;
  rowPath: readonly string[];
  derived: Readonly<Record<string, unknown>>;
}

/** The table a module's overlay or panel runs in (ADR-077). */
export interface FrameModule {
  tableId: string;
  viewer: Viewer;
  settings: Readonly<Record<string, Value>>;
}

/**
 * What a frame renders: a `custom:<name>` node, a card, a module's overlay or panel, or
 * nothing, to list the exports.
 */
export type FrameView =
  | { kind: 'node'; name: string; props: Readonly<Record<string, unknown>>; sheet: FrameSheet }
  | {
      kind: 'card';
      name: string;
      card: unknown;
      rolls: readonly unknown[];
      speaker: unknown;
    }
  | { kind: 'overlay'; name: string; module: FrameModule }
  | { kind: 'panel'; name: string; module: FrameModule }
  | { kind: 'probe' };

/** Everything a frame needs to run the plugin's code. */
export interface FrameSetup {
  pluginId: string;
  /** `code/client.js`, as text: the frame cannot fetch it, having no session. */
  code: string;
  /**
   * The page's stylesheets as text: the app's, so plugin components look like the app, and
   * the plugin's scoped ones (ADR-021). The frame cannot fetch them, having no network.
   */
  styles: string[];
  /** The plugin's texts in the viewer's language, then in its default one. */
  lang: Readonly<Record<string, string>>[];
  view: FrameView;
}

/** App → frame. */
export type HostMessage =
  | { type: 'init'; setup: FrameSetup }
  /** The node's sheet changed: new data, derived values or rights. */
  | { type: 'sheet'; sheet: FrameSheet }
  /** A table event the viewer sees, for a module frame (ADR-077). */
  | { type: 'event'; event: TableEvent }
  /** The module's settings for the viewer changed. */
  | { type: 'settings'; settings: Readonly<Record<string, Value>> }
  /** How an action ended: its value, or why it was refused. */
  | { type: 'result'; id: string; ok: true; value: unknown }
  | { type: 'result'; id: string; ok: false; error: string };

/** The most actions a frame may take in `ACTION_WINDOW_MS`; more are refused (ADR-077). */
export const ACTION_LIMIT = 10;
export const ACTION_WINDOW_MS = 10_000;

/** What a module frame asks the host to do as the viewer; the server checks each. */
export const frameActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), input: chatSendBody }),
  z.object({ kind: z.literal('roll'), input: rollRequestBody }),
  z.object({ kind: z.literal('openSheet'), actorId: z.uuid() }),
  z.object({ kind: z.literal('openJournal'), entryId: z.uuid() }),
  z.object({ kind: z.literal('combat'), action: z.enum(COMBAT_ACTIONS) }),
  z.object({ kind: z.literal('encounter') }),
  z.object({
    kind: z.literal('setting'),
    name: z.string().min(1).max(64),
    value: z.union([z.number(), z.string().max(2000), z.boolean()]),
  }),
]);
export type FrameAction = z.infer<typeof frameActionSchema>;

const path = z.string().min(1).max(256);

/** Frame → app, checked on arrival. */
export const frameMessageSchema = z.discriminatedUnion('type', [
  /** The frame page has loaded and waits for `init`. */
  z.object({ type: z.literal('ready') }),
  /** The content's height, so the app sizes the frame to it. */
  z.object({ type: z.literal('height'), height: z.number().min(0).max(1e6) }),
  /** `useField`'s setter, as a path relative to the node's row. */
  z.object({ type: z.literal('set'), path, value: z.unknown() }),
  z.object({ type: z.literal('adjust'), path, delta: z.number() }),
  /** What a probe found: the nodes, cards, overlays and panels the code exports. */
  z.object({
    type: z.literal('exports'),
    nodes: z.array(z.string().max(64)).max(200),
    cards: z.array(z.string().max(64)).max(200),
    overlays: z
      .array(z.object({ name: z.string().max(64), interactive: z.boolean() }))
      .max(20)
      .default([]),
    panels: z
      .array(z.object({ name: z.string().max(64), title: z.string().max(200) }))
      .max(20)
      .default([]),
  }),
  /** A module frame acts as the viewer; the host answers with `result`. */
  z.object({
    type: z.literal('action'),
    id: z.string().min(1).max(64),
    action: z.unknown(),
  }),
  /** The code failed to load or render; `message` is for the console. */
  z.object({ type: z.literal('failed'), message: z.string().max(2000) }),
]);
export type FrameMessage = z.infer<typeof frameMessageSchema>;
