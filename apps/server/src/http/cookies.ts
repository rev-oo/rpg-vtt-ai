import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE = 'vtt_session';

/**
 * Session cookie attributes (FR-AUTH-04): HTTP-only, SameSite=Lax, and Secure whenever the
 * instance is served over HTTPS.
 */
export function sessionCookieOptions(publicUrl: URL, expiresAt: Date): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl.protocol === 'https:',
    path: '/',
    expires: expiresAt,
  };
}

/** Attributes for clearing the cookie; must match path/flags of the one being cleared. */
export function clearedSessionCookieOptions(publicUrl: URL): CookieSerializeOptions {
  return { ...sessionCookieOptions(publicUrl, new Date(0)), maxAge: 0 };
}
