import type { DestinationStream } from 'pino';

/** A pino destination that keeps parsed log lines in memory for assertions. */
export function captureLogs(): DestinationStream & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    write(message: string) {
      lines.push(JSON.parse(message) as Record<string, unknown>);
    },
  };
}
