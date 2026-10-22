import type { Value } from '@vtt/formula';

/** How a formula result reads in a card or in plain text. */
export const formatValue = (value: Value): string =>
  Array.isArray(value) ? value.map(String).join(', ') : String(value);
