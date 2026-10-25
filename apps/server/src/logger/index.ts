// The only server module allowed to write to the console (specs §6.2).
import { pino, type DestinationStream, type Logger } from 'pino';

import type { LogLevel } from '../config/index.js';

/** Invite tokens are bearer secrets: whoever reads one can join the table (FR-TABLE-03). */
const INVITE_TOKEN_IN_URL = /(\/invites\/)[\w-]{43}/g;

/** A request URL as logs may show it. */
function redactUrl(url: string): string {
  return url.replace(INVITE_TOKEN_IN_URL, '$1[redacted]');
}

interface LoggedRequest {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

function serializeRequest(req: LoggedRequest) {
  return {
    method: req.method,
    url: req.url === undefined ? undefined : redactUrl(req.url),
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/**
 * Structured JSON logger (NFR-12). Requests are logged without headers and with invite tokens
 * redacted from the URL; a `set-cookie` response header is redacted too.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'vtt-server' },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Fastify's usual request fields, with the URL redacted; never the raw request.
      serializers: { req: serializeRequest },
      redact: {
        paths: ['res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
