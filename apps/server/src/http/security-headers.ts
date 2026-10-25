import type { FastifyInstance } from 'fastify';

/**
 * Headers for every response (NFR-05, T-0701). API answers are data, never a page, so their
 * policy allows nothing. A page brings its own policy in a <meta> tag
 * (apps/web/scripts/finish-page.ts), which cannot forbid framing, so pages get a
 * policy that only does that; both apply. A route that sets its own policy, like plugin
 * assets, keeps it.
 */
export const DATA_POLICY = "default-src 'none'; frame-ancestors 'none'";
export const PAGE_POLICY = "frame-ancestors 'none'";

const HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Invite links carry their token in the path; other sites never see the path.
  'referrer-policy': 'same-origin',
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('content-security-policy')) {
      const type = reply.getHeader('content-type');
      const page = typeof type === 'string' && type.startsWith('text/html');
      reply.header('content-security-policy', page ? PAGE_POLICY : DATA_POLICY);
    }
    for (const [name, value] of Object.entries(HEADERS)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    return payload;
  });
}
