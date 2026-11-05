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

/** The page plugin frames load (ADR-074); the web app builds it. */
export const FRAME_PAGE = '/plugin-frame.html';
/**
 * Its policy, on top of the stricter one in the page itself: opened anywhere, even on its own,
 * it gets an opaque origin and no network. It may be framed by any page, since it holds no
 * data and can reach nothing: the code it runs is what its parent sends it.
 */
export const FRAME_PAGE_POLICY = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline' data:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Invite links carry their token in the path; other sites never see the path.
  'referrer-policy': 'same-origin',
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const framePage = request.url.split('?')[0] === FRAME_PAGE;
    if (framePage) reply.header('content-security-policy', FRAME_PAGE_POLICY);
    // A 304 has no content type; the browser keeps the stored response's policy, so none is
    // sent rather than one meant for data.
    if (reply.statusCode !== 304 && !reply.hasHeader('content-security-policy')) {
      const type = reply.getHeader('content-type');
      const page = typeof type === 'string' && type.startsWith('text/html');
      reply.header('content-security-policy', page ? PAGE_POLICY : DATA_POLICY);
    }
    for (const [name, value] of Object.entries(HEADERS)) {
      if (framePage && name === 'x-frame-options') continue;
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    return payload;
  });
}
