import { z } from 'zod';

// Building blocks shared by every plugin file (specs §8). The schemas carry no messages:
// the validator (T-0402) words every issue with its file and JSON path.

/** `tiny-d20`: lowercase letters, digits and inner hyphens. */
export const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
/** Semantic version, such as `1.0.0` or `2.1.0-beta.1`. */
export const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** `en`, `pt-BR`. */
export const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
/** Names formulas can reference: field names, derived values, recipes, settings. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** File-like names: types, sheets, cards, custom nodes, handlers. */
export const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Custom dice, as the formula grammar reads them (ADR-017): `dF`, `dB2`. */
export const DIE_NAME = /^d[A-Z][A-Z0-9]*$/;

export const identifier = z.string().regex(IDENTIFIER);
export const name = z.string().regex(NAME);

/** A formula in the language of specs §8.9; the validator parses it. */
export const formula = z.string().min(1).max(2000).describe('A formula (specs §8.9).');

/** A lang key such as `type.character`, or literal text when no lang file has the key. */
export const text = z.string().min(1).max(500);

/** Extra CSS classes; plugin CSS is scoped (specs §8.6). */
export const cssClass = z.string().max(200);

/** Lets editors find the JSON Schema of a file. */
export const schemaUrl = { $schema: z.string().optional() };
