import { en, type MessageKey, type Messages } from './en.js';
import { ptBR } from './pt-BR.js';

export type { MessageKey } from './en.js';

/** The UI languages (NFR-11); `en` is the default and the reference catalogue. */
export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

const CATALOGUES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

/** Each language in its own words, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

const STORAGE_KEY = 'vtt.locale';

const asLocale = (value: string | null | undefined): Locale | undefined =>
  LOCALES.find((locale) => locale === value);

/** The chosen language if any, else the first browser language we have (by language). */
export function pickLocale(chosen: string | null, languages: readonly string[]): Locale {
  const picked = asLocale(chosen);
  if (picked) return picked;
  for (const language of languages) {
    const exact = asLocale(language);
    if (exact) return exact;
    const base = language.split('-')[0]?.toLowerCase();
    const match = LOCALES.find((locale) => locale.split('-')[0] === base);
    if (match) return match;
  }
  return 'en';
}

/** The language chosen on the account page, kept per browser; `null` follows the browser. */
export function chosenLocale(): Locale | null {
  try {
    return asLocale(localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function chooseLocale(locale: Locale | null): void {
  try {
    if (locale) localStorage.setItem(STORAGE_KEY, locale);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage (blocked, or prerendering): the browser’s language applies.
  }
}

/**
 * The UI language; plugin texts are looked up in it first. Fixed until the page reloads.
 * The build prerenders the loading page in English: Node has a `navigator` of its own.
 */
const inBrowser = typeof window !== 'undefined';
export const LOCALE: Locale = inBrowser ? pickLocale(chosenLocale(), navigator.languages) : 'en';

const messages: Messages = CATALOGUES[LOCALE];

/** Looks up a UI string and fills `{name}` placeholders. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
