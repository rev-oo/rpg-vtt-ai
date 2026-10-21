import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { PLUGIN_ID } from '@vtt/plugin-schema';

import { findPlugin, isAvailable } from '../../domain/plugins.js';
import { notFound } from '../../errors.js';
import { findPluginAsset } from '../../plugins/assets.js';
import { ScopedCssCache } from '../../plugins/css-cache.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';

const params = z.object({ id: z.string(), '*': z.string() });
const STYLESHEET = /^styles\/[^/]+\.css$/;

/**
 * Plugin files at `/plugins/<id>/*` (§4.2, T-0405), for signed-in users and only while the
 * plugin is available, so a disabled plugin's code is never served.
 *
 * Stylesheets are served scoped (§8.6) and only from `styles/`. Responses use `no-cache`
 * with an ETag, because plugin files change on rescan without a new URL.
 */
export function pluginAssetRoutes({ app, db, config, plugins }: AppContext): void {
  const css = new ScopedCssCache(path.join(config.dataDir, 'cache', 'css'));

  app.get('/plugins/:id/*', async (request, reply) => {
    requireSession(request);
    const parsed = params.safeParse(request.params);
    if (!parsed.success || !PLUGIN_ID.test(parsed.data.id)) throw notFound();
    const { id, '*': requestPath } = parsed.data;
    const plugin = findPlugin(db, id);
    if (!plugin || !isAvailable(plugin)) throw notFound();

    const asset = await findPluginAsset(path.join(plugins.dir, id), requestPath);
    if (!asset) throw notFound();
    if (asset.relative.endsWith('.css') && !STYLESHEET.test(asset.relative)) throw notFound();

    reply.header('cache-control', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    // An SVG opened on its own must not run scripts.
    if (asset.type.startsWith('image/svg')) {
      reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    }
    reply.type(asset.type);

    if (STYLESHEET.test(asset.relative)) {
      const scoped = await css.get(id, asset.relative, await readFile(asset.file, 'utf8'));
      const etag = `"${createHash('sha256').update(scoped.css).digest('base64url')}"`;
      return notModified(request, reply, etag) ?? reply.send(scoped.css);
    }
    const etag = `"${asset.size.toString(36)}-${Math.trunc(asset.mtimeMs).toString(36)}"`;
    return notModified(request, reply, etag) ?? reply.send(createReadStream(asset.file));
  });
}

/** Sets the ETag and answers 304 when the client already has this version. */
function notModified(request: FastifyRequest, reply: FastifyReply, etag: string) {
  reply.header('etag', etag);
  const sent = request.headers['if-none-match'];
  if (!sent?.split(',').some((tag) => tag.trim() === etag)) return undefined;
  return reply.code(304).send();
}
