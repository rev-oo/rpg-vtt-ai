// Plugin texts with parameters (T-1611): what server code posts by lang key, filled in for each
// viewer's language on the web and in English for the message's stored text.

/** The parameters of a plugin text, by name. */
export type LangParams = Readonly<Record<string, string | number>>;

const PARAM = /\{([A-Za-z0-9_]+)\}/g;

/**
 * A plugin text with its parameters filled in: `{name}` in the text becomes the `name`
 * parameter, itself translated when it is a lang key (`ability.dex`). A placeholder without a
 * parameter stays as written.
 */
export function langText(
  translate: (text: string) => string,
  key: string,
  params: LangParams = {},
): string {
  return translate(key).replace(PARAM, (whole: string, name: string) => {
    if (!Object.hasOwn(params, name)) return whole;
    const value = params[name];
    return typeof value === 'string' ? translate(value) : String(value);
  });
}
