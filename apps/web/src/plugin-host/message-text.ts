import { langText } from '@vtt/plugin-engine';
import type { ChatMessage } from '@vtt/shared/api';

import { useSystem } from './system-context.js';

/**
 * A message's text as the viewer reads it (T-1611): text plugin code posted by lang key is in
 * the viewer's language while the table's system is that plugin; otherwise the stored text.
 */
export function useMessageText(message: ChatMessage): string {
  const host = useSystem();
  const { translation } = message;
  if (!translation || host.status !== 'ready' || host.system.id !== translation.plugin)
    return message.text;
  return langText(host.translate, translation.key, translation.params);
}
