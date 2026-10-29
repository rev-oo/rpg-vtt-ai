import { createReadStream, existsSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { isGmLike } from '@vtt/shared';
import { MAX_UPLOAD_BYTES, uploadAssetQuery } from '@vtt/shared/api';

import {
  assetFile,
  deleteAsset,
  listAssets,
  requireAsset,
  storeAsset,
  toAssetView,
} from '../../domain/assets.js';
import { requireUnarchived } from '../../domain/entities.js';
import { findMembership } from '../../domain/tables.js';
import { badRequest, notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/** An asset's bytes never change under its id (ADR-064). */
const IMMUTABLE = 'private, max-age=31536000, immutable';

/**
 * Table assets (FR-ASSET-01, ADR-064): GMs and assistants upload images, which every member
 * of the table may read at `/api/v1/assets/:id`.
 */
export function assetRoutes({ app: root, db, config, now, instance, collab }: AppContext): void {
  // A scope of its own, so the image body parsers apply to these routes alone.
  void root.register((app, _options, done) => {
    routes(app);
    done();
  });

  function routes(app: FastifyInstance): void {
    // Images arrive as the raw body, as plugin archives do (ADR-026). These types are not
    // CORS-safelisted, so a cross-site form cannot send them without a preflight.
    for (const type of [/^image\//, 'application/octet-stream']) {
      app.addContentTypeParser(
        type,
        { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
        (_request, body, done) => {
          done(null, body);
        },
      );
    }

    app.get('/api/v1/tables/:id/assets', (request) => {
      const { id } = parseInput(idParams, request.params);
      requireMember(db, request, id);
      return { assets: listAssets(db, id).map(toAssetView) };
    });

    app.post(
      '/api/v1/tables/:id/assets',
      { bodyLimit: MAX_UPLOAD_BYTES },
      async (request, reply) => {
        const { id } = parseInput(idParams, request.params);
        const { table, membership } = requireMember(db, request, id, isGmLike);
        requireUnarchived(table);
        const { name } = parseInput(uploadAssetQuery, request.query);
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          throw badRequest('image_required', 'Send the image as the request body.');
        }
        const asset = storeAsset(
          db,
          config.dataDir,
          { tableId: id, uploaderId: membership.userId, name, bytes: request.body, now: now() },
          instance(),
        );
        return reply.code(201).send({ asset: toAssetView(asset) });
      },
    );

    /** Deletes an image no actor, item or journal entry uses (ADR-065). */
    app.delete('/api/v1/assets/:id', (request, reply) => {
      const { id } = parseInput(idParams, request.params);
      const asset = requireAsset(db, id);
      const { table } = requireMember(db, request, asset.tableId, isGmLike);
      requireUnarchived(table);
      deleteAsset(db, config.dataDir, asset, collab.hocuspocus.documents);
      return reply.code(204).send();
    });

    app.get('/api/v1/assets/:id', (request, reply) => {
      const session = requireSession(request);
      const parsed = idParams.safeParse(request.params);
      if (!parsed.success) throw notFound('Asset not found.');
      const asset = requireAsset(db, parsed.data.id);
      // Only the table's members see it; anyone else cannot tell it exists.
      if (!findMembership(db, asset.tableId, session.user.id)) throw notFound('Asset not found.');
      const file = assetFile(config.dataDir, asset);
      if (!existsSync(file)) throw notFound('Asset not found.');
      reply.header('cache-control', IMMUTABLE);
      reply.type(asset.type);
      return reply.send(createReadStream(file));
    });
  }
}
