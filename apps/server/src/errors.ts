/**
 * An expected failure with a stable `code` (specs §10.1). The HTTP layer renders it as
 * `{ error: { code, message, details? } }` with the given status.
 */
export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required.'): AppError =>
  new AppError(401, 'unauthenticated', message);
export const forbidden = (message = 'You do not have permission to do that.'): AppError =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.'): AppError =>
  new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string): AppError =>
  new AppError(409, code, message);
export const gone = (code: string, message: string): AppError => new AppError(410, code, message);
export const unprocessable = (code: string, message: string): AppError =>
  new AppError(422, code, message);
