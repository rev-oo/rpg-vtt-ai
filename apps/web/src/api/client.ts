import type { z } from 'zod';

import { errorResponseSchema } from './schemas.js';

const BASE = '/api/v1';
const CSRF_HEADER = 'X-CSRF-Token';

/** An error response from the API, with its stable `code` (specs §10.1). */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

/** Set from login, setup and `/me`; sent with every mutating request. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function request<T extends z.ZodType>(
  method: Method,
  path: string,
  schema: T,
  body?: unknown,
): Promise<z.infer<T>> {
  const response = await send(method, path, body);
  return schema.parse(await response.json());
}

/** For endpoints that answer 204 No Content. */
export async function requestNoContent(
  method: Method,
  path: string,
  body?: unknown,
): Promise<void> {
  await send(method, path, body);
}

async function send(method: Method, path: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfter = Number(response.headers.get('retry-after'));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  const parsed = errorResponseSchema.safeParse(await response.json().catch(() => null));
  const { code, message } = parsed.success
    ? parsed.data.error
    : { code: 'http_error', message: response.statusText };
  return new ApiError(response.status, code, message, retryAfterSeconds);
}
