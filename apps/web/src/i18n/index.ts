import { en, type MessageKey, type Messages } from './en.js';

export type { MessageKey } from './en.js';

// Only `en` ships in M1; `pt-BR` and locale selection arrive with T-0703 (NFR-11).
const messages: Messages = en;

/** The UI language; plugin texts are looked up in it first. */
export const LOCALE = 'en';

/** Looks up a UI string and fills `{name}` placeholders. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
