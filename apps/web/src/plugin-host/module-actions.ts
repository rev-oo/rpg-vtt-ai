import type { TableEvent } from '@vtt/sdk/client';
import type { ServerEvent } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { entryPanelId, sheetPanelId, type PanelTarget } from '../features/workspace/panel-ids.js';
import { t } from '../i18n/index.js';

import { ACTION_LIMIT, ACTION_WINDOW_MS, frameActionSchema } from './frame-protocol.js';

// What a module frame may hear and do (T-1603, ADR-077). A frame hears the events this page
// receives, which the server already filtered for the viewer, and acts through the API with
// the viewer's own session, so the server checks each action as the viewer's.

/** A table event as a module frame gets it, or null for those frames do not get. */
export function frameEvent(event: ServerEvent): TableEvent | null {
  switch (event.type) {
    case 'chat.message':
    case 'chat.updated':
      return { type: event.type, message: event.payload.message };
    case 'chat.deleted':
      return { type: 'chat.deleted', id: event.payload.id };
    case 'combat.updated':
    case 'scene.updated':
      return { type: event.type };
    case 'token.updated':
      return { type: 'token.updated', sceneId: event.payload.sceneId };
    default:
      return null;
  }
}

/** True while a frame may act: at most `limit` actions in any `windowMs`. */
export function rateLimiter(
  limit = ACTION_LIMIT,
  windowMs = ACTION_WINDOW_MS,
  now: () => number = Date.now,
): () => boolean {
  const times: number[] = [];
  return () => {
    const current = now();
    while (times.length > 0 && (times[0] ?? 0) <= current - windowMs) times.shift();
    if (times.length >= limit) return false;
    times.push(current);
    return true;
  };
}

/** What an action needs from the page. */
export interface ActionContext {
  tableId: string;
  moduleId: string;
  /** The ids of the actors the viewer sees. */
  actorIds: () => readonly string[];
  /** Opens a sheet or journal entry in the workspace. */
  open: (target: PanelTarget) => void;
  /** Loads the modules again, so frames get changed settings. */
  reload: () => void;
}

/** An action refused before or by the server; its message is for the module's author. */
export class ActionError extends Error {}

/** Runs one action a frame asked for, as the viewer; resolves with what the frame gets. */
export async function runAction(raw: unknown, context: ActionContext): Promise<unknown> {
  const parsed = frameActionSchema.safeParse(raw);
  if (!parsed.success) throw new ActionError(t('module.badAction'));
  const action = parsed.data;
  try {
    switch (action.kind) {
      case 'chat':
        await api.sendChat(context.tableId, action.input);
        return null;
      case 'roll':
        await api.roll(context.tableId, action.input);
        return null;
      case 'openSheet':
        if (!context.actorIds().includes(action.actorId)) {
          throw new ActionError(t('module.notFound'));
        }
        context.open({
          kind: 'sheet',
          id: sheetPanelId(action.actorId),
          actorId: action.actorId,
        });
        return null;
      case 'openJournal':
        // The server answers only for an entry the viewer may read.
        await api.getJournalEntry(action.entryId);
        context.open({
          kind: 'entry',
          id: entryPanelId(action.entryId),
          entryId: action.entryId,
        });
        return null;
      case 'combat':
        await combat(context.tableId, action.action);
        return null;
      case 'encounter':
        return await api.getEncounter(context.tableId);
      case 'setting':
        // The server takes only the module's `user` settings here (ADR-075).
        await api.updateMyPluginSettings(context.moduleId, { [action.name]: action.value });
        context.reload();
        return null;
    }
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(errorMessage(error));
  }
}

function combat(
  tableId: string,
  action: 'start' | 'end' | 'next' | 'previous' | 'initiative',
): Promise<unknown> {
  switch (action) {
    case 'start':
      return api.startEncounter(tableId);
    case 'end':
      return api.endEncounter(tableId);
    case 'next':
    case 'previous':
      return api.moveTurn(tableId, action);
    case 'initiative':
      return api.rollInitiative(tableId);
  }
}
