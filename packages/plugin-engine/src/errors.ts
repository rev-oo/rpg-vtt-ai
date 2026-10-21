export type EngineErrorCode = 'unknown_type' | 'unknown_recipe' | 'handler_recipe';

/** A request the plugin cannot serve: a type or recipe it does not define. */
export class EngineError extends Error {
  override readonly name = 'EngineError';

  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
  }
}
