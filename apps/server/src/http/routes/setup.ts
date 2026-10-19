import { z } from 'zod';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../domain/auth/password.js';
import { countUsers, insertUser, prepareUser, toPublicUser } from '../../domain/users.js';
import { conflict } from '../../errors.js';
import type { AppContext } from '../app.js';
import { setSessionCookie } from '../auth.js';
import { displayNameSchema, parseInput, usernameSchema } from '../validation.js';

const setupAdminBody = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

const alreadySetUp = () => conflict('already_set_up', 'This instance already has users.');

/** First-run setup (FR-AUTH-01): only valid while the instance has no users. */
export function setupRoutes({ app, db, config, sessions }: AppContext): void {
  app.get('/api/v1/setup/status', () => ({ needsSetup: countUsers(db) === 0 }));

  app.post('/api/v1/setup/admin', async (request, reply) => {
    if (countUsers(db) > 0) throw alreadySetUp();
    const body = parseInput(setupAdminBody, request.body);
    const prepared = await prepareUser({ ...body, isAdmin: true });

    // Re-check inside a transaction: two concurrent setup requests must not both win.
    const admin = db.transaction((tx) => {
      if (countUsers(tx) > 0) throw alreadySetUp();
      return insertUser(tx, prepared);
    });

    const issued = sessions.create(admin.id);
    setSessionCookie(reply, config.publicUrl, issued);
    return reply.code(201).send({ user: toPublicUser(admin), csrfToken: issued.csrfToken });
  });
}
