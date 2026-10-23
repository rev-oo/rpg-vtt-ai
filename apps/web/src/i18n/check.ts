/** A difference between a translation and the reference catalogue (NFR-11). */
export interface CatalogueProblem {
  key: string;
  problem: 'missing' | 'extra' | 'empty' | 'placeholders';
}

const placeholders = (text: string): string =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');

/**
 * Compares a catalogue with the reference: every key present, no extra ones, nothing empty,
 * and the same `{placeholders}`, so `t()` fills the same values in every language.
 */
export function catalogueProblems(
  reference: Readonly<Record<string, string>>,
  catalogue: Readonly<Record<string, string>>,
): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  for (const [key, text] of Object.entries(reference)) {
    const translated = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
    if (translated === undefined) problems.push({ key, problem: 'missing' });
    else if (translated.trim() === '') problems.push({ key, problem: 'empty' });
    else if (placeholders(translated) !== placeholders(text)) {
      problems.push({ key, problem: 'placeholders' });
    }
  }
  for (const key of Object.keys(catalogue)) {
    if (!Object.hasOwn(reference, key)) problems.push({ key, problem: 'extra' });
  }
  return problems;
}
