export type EngineErrorCode =
  | 'unknown_type'
  | 'unknown_recipe'
  | 'handler_recipe'
  /** The recipe lists the actor types it is for, and this one is not among them (T-1608). */
  | 'wrong_actor_type'
  /** An option the recipe does not declare, or a value its declaration refuses (T-1609). */
  | 'bad_option'
  /** Targets for a recipe that targets nothing, or an actor of a type it does not target (T-1615). */
  | 'bad_target';

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
