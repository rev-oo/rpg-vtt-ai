import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Paths the server answers itself; a miss there is a plain 404, never the app. */
const SERVER_PATHS = ['/api/', '/ws/', '/plugins/'];

/** Whether `dir` holds a built web app (`apps/web/build/client`). */
export function isWebApp(dir: string): boolean {
  return existsSync(path.join(dir, 'index.html'));
}

/**
 * Serves the built SPA from `dir` (specs §4.2, T-0703). Hashed files under `assets/` are
 * cached for good; everything else, `index.html` and the plugin runtime shims included, is
 * revalidated, since a new build reuses those names. The files are listed once at startup.
 */
export async function registerWebApp(app: FastifyInstance, dir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: dir,
    wildcard: false,
    setHeaders: (reply, file) => {
      const immutable = path.relative(dir, file).startsWith(`assets${path.sep}`);
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}

/**
 * Whether a request that matched no route is a page of the app: a GET or HEAD outside the
 * server's own paths whose last segment is not a file name. The app routes it client-side.
 */
export function isAppPage(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const pathname = request.url.split('?')[0] ?? '';
  if (SERVER_PATHS.some((prefix) => pathname.startsWith(prefix))) return false;
  return !(pathname.split('/').pop() ?? '').includes('.');
}

export function sendAppPage(reply: FastifyReply): FastifyReply {
  return reply.sendFile('index.html');
}
