// What the plugin validator reports (FR-PLUGIN-02, T-0402). Issues carry a code and
// parameters, not prose: `describePluginIssue` words them in English for the server and the
// CLI, and the web admin page translates the codes.

export const PLUGIN_ISSUE_CODES = [
  // Files
  'missing_file',
  'invalid_json',
  'unknown_file',
  'invalid_name',
  // Shapes (from the Zod schemas)
  'missing_key',
  'unknown_key',
  'unsupported_keyword',
  'invalid_value',
  'unknown_node',
  // Data schemas
  'invalid_default',
  'invalid_annotation',
  'reserved_name',
  // Formulas
  'invalid_formula',
  'unknown_reference',
  'unknown_function',
  'unknown_die',
  'dice_not_allowed',
  'derived_cycle',
  // Links between files
  'missing_target',
  'unknown_field',
  'field_mismatch',
  // Code
  'has_code_mismatch',
  'code_required',
  // Translations
  'missing_lang_file',
  'missing_lang_key',
  'unlisted_locale',
] as const;
export type PluginIssueCode = (typeof PLUGIN_ISSUE_CODES)[number];

/** Keys and indices from the root of a JSON file down to the offending value. */
export type JsonPath = readonly (string | number)[];

export interface PluginIssue {
  /** Errors make the plugin unusable; warnings are listed but do not block it. */
  severity: 'error' | 'warning';
  code: PluginIssueCode;
  /** The file, relative to the plugin folder (`sheets/character.json`). */
  file: string;
  path: JsonPath;
  params: Readonly<Record<string, string | number>>;
}

const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `$.layout.children[2].path`; keys that are not identifiers are quoted: `$["hit-points"]`. */
export function formatJsonPath(path: JsonPath): string {
  return path.reduce<string>((text, key) => {
    if (typeof key === 'number') return `${text}[${String(key)}]`;
    return IDENTIFIER_KEY.test(key) ? `${text}.${key}` : `${text}[${JSON.stringify(key)}]`;
  }, '$');
}

type Params = PluginIssue['params'];
const p = (params: Params, key: string): string => String(params[key] ?? '');

const UNITS: Readonly<Record<string, string>> = { string: ' characters', array: ' items' };

function describeInvalidValue(x: Params): string {
  const unit = UNITS[p(x, 'origin')] ?? '';
  switch (x.reason) {
    case 'type':
      return `Expected ${p(x, 'expected')}`;
    case 'too_small':
      return `Must be at least ${p(x, 'minimum')}${unit}`;
    case 'too_big':
      return `Must be at most ${p(x, 'maximum')}${unit}`;
    case 'enum':
      return `Expected one of ${p(x, 'values')}`;
    case 'invalid_format':
      return 'Does not have the expected format';
    default:
      return 'Invalid value';
  }
}

const DESCRIPTIONS: Record<PluginIssueCode, (params: Params) => string> = {
  missing_file: (x) => `The file ${p(x, 'file')} is required`,
  invalid_json: (x) => `The file is not valid JSON: ${p(x, 'detail')}`,
  unknown_file: () => 'This file is not part of the plugin format and is ignored',
  invalid_name: (x) => `"${p(x, 'name')}" is not a valid ${p(x, 'of')} name`,
  missing_key: (x) => `"${p(x, 'key')}" is required`,
  unknown_key: (x) => `Unknown key "${p(x, 'key')}"`,
  unsupported_keyword: (x) =>
    `"${p(x, 'key')}" is not supported in plugin data schemas (specs §8.4)`,
  invalid_value: describeInvalidValue,
  unknown_node: (x) => `Unknown sheet node "${p(x, 'type')}"`,
  invalid_default: (x) => `The default does not fit the field: ${p(x, 'reason')}`,
  invalid_annotation: (x) => `${p(x, 'key')} cannot be used on a field of type ${p(x, 'type')}`,
  reserved_name: (x) => `"${p(x, 'name')}" is reserved for formulas and cannot name a field`,
  invalid_formula: (x) =>
    `Invalid formula: ${p(x, 'detail')} (line ${p(x, 'line')}, column ${p(x, 'column')})`,
  unknown_reference: (x) => `${p(x, 'reference')} does not exist in ${p(x, 'scope')}`,
  unknown_function: (x) => `Unknown function "${p(x, 'name')}"`,
  unknown_die: (x) => `Unknown die "${p(x, 'name')}"; declare it in dice.json`,
  dice_not_allowed: () => 'Dice can only be used in roll formulas',
  derived_cycle: (x) => `Derived values depend on each other: ${p(x, 'cycle')}`,
  missing_target: (x) => `There is no ${p(x, 'target')} named "${p(x, 'name')}"`,
  unknown_field: (x) => `"${p(x, 'field')}" is not a field of ${p(x, 'scope')}`,
  field_mismatch: (x) => `"${p(x, 'field')}" must be ${p(x, 'expected')} here`,
  has_code_mismatch: (x) =>
    x.hasCode === 'true'
      ? 'hasCode is true but the plugin has no code/ folder'
      : 'The plugin has a code/ folder, so hasCode must be true',
  code_required: (x) => `${p(x, 'feature')} needs plugin code; set hasCode and add code/`,
  missing_lang_file: (x) => `There is no translation file lang/${p(x, 'locale')}.json`,
  missing_lang_key: (x) => `"${p(x, 'key')}" has no ${p(x, 'locale')} translation`,
  unlisted_locale: (x) => `${p(x, 'locale')} is not listed in the manifest's locales`,
};

/** The issue in English, with its location: `sheets/a.json $.layout: Unknown key "x"`. */
export function describePluginIssue(issue: PluginIssue): string {
  const where = issue.path.length > 0 ? `${issue.file} ${formatJsonPath(issue.path)}` : issue.file;
  return `${where}: ${DESCRIPTIONS[issue.code](issue.params)}`;
}
