/** Only follow same-origin, in-app paths after login (no open redirects). */
export function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}
