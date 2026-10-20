/** What the chat input asks for (FR-CHAT-08). */
export type ChatInput =
  | { kind: 'empty' }
  | { kind: 'message'; text: string }
  /** `/r` rolls publicly, `/gmr` as a secret roll to the GM (FR-CHAT-05). */
  | { kind: 'roll'; formula: string; audience: 'public' | 'gm' }
  | { kind: 'usage'; command: string }
  | { kind: 'unknown'; command: string };

const ROLL_COMMANDS: Record<string, 'public' | 'gm'> = { r: 'public', gmr: 'gm' };

/**
 * Splits chat input into a plain message or a command. Only the system-agnostic dice
 * commands exist in the MVP; plugin commands arrive in v1. `//` escapes a leading slash.
 */
export function parseChatInput(input: string): ChatInput {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  if (text.startsWith('//')) return { kind: 'message', text: text.slice(1) };
  if (!text.startsWith('/')) return { kind: 'message', text };

  const [head = '', ...rest] = text.slice(1).split(/\s+/);
  const command = head.toLowerCase();
  const formula = rest.join(' ');
  const audience = Object.hasOwn(ROLL_COMMANDS, command) ? ROLL_COMMANDS[command] : undefined;
  if (!audience) return { kind: 'unknown', command: `/${head}` };
  if (formula === '') return { kind: 'usage', command: `/${command}` };
  return { kind: 'roll', formula, audience };
}
