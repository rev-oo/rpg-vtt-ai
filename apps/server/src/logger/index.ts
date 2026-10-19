// The only server module allowed to write to the console (specs §6.2).
import { pino, type DestinationStream, type Logger } from 'pino';

import type { LogLevel } from '../config/index.js';

/** Structured JSON logger (NFR-12). Secrets in request headers are redacted. */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'vtt-server' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
