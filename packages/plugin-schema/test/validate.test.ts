import { describe, expect, it } from 'vitest';

import {
  describePluginIssue,
  formatJsonPath,
  PLUGIN_ISSUE_CODES,
  type PluginIssue,
  validatePlugin,
} from '../src/index.js';

import { CASES, mini, type PluginFixture } from './fixtures/plugins.js';
import { pluginFiles, REFERENCE_PLUGINS } from './support/plugins.js';

/** A fixture as the validator receives it: JSON files serialised, other files as text. */
const toFiles = (fixture: PluginFixture) =>
  new Map(
    Object.entries(fixture).map(([path, value]) => [
      path,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );

const summary = (issue: PluginIssue) =>
  `${issue.severity} ${issue.code} ${issue.file} ${formatJsonPath(issue.path)}`;

describe('validatePlugin', () => {
  it('accepts the mini fixture and returns its definition', () => {
    const { issues, plugin } = validatePlugin(toFiles(mini()));
    expect(issues).toEqual([]);
    expect(plugin?.manifest.id).toBe('mini');
    expect(Object.keys(plugin?.actorTypes ?? {})).toEqual(['hero']);
    expect(Object.keys(plugin?.rolls ?? {})).toEqual(['skill']);
    expect(plugin?.styles).toEqual(['styles/sheet.css']);
  });

  it.each(CASES)('reports $name', ({ change, issues, valid }) => {
    const fixture = mini();
    change(fixture);
    const result = validatePlugin(toFiles(fixture));
    expect(result.issues.map(summary).sort()).toEqual([...issues].sort());
    expect(result.plugin !== undefined).toBe(valid === true);
  });

  it.each(REFERENCE_PLUGINS)('accepts the reference plugin %s', async (id) => {
    const files = await pluginFiles(id);
    const { issues, plugin } = validatePlugin(files);
    expect(issues.map(describePluginIssue)).toEqual([]);
    expect(plugin?.manifest.id).toBe(id);
  });
});

describe('describing issues', () => {
  const issue = (
    code: PluginIssue['code'],
    params: PluginIssue['params'] = {},
    path: (string | number)[] = [],
  ) => describePluginIssue({ severity: 'error', code, file: 'sheets/a.json', path, params });

  it('formats JSON paths', () => {
    expect(formatJsonPath([])).toBe('$');
    expect(formatJsonPath(['layout', 'children', 2, 'path'])).toBe('$.layout.children[2].path');
    expect(formatJsonPath(['properties', 'hit-points'])).toBe('$.properties["hit-points"]');
  });

  it('words every issue with its file and path', () => {
    expect(issue('unknown_key', { key: 'x' }, ['layout'])).toBe(
      'sheets/a.json $.layout: Unknown key "x"',
    );
    expect(issue('invalid_formula', { detail: 'Expected a value', line: 1, column: 4 })).toBe(
      'sheets/a.json: Invalid formula: Expected a value (line 1, column 4)',
    );
    expect(issue('has_code_mismatch', { hasCode: 'true' })).toContain('no code/ folder');
    expect(issue('has_code_mismatch', { hasCode: 'false' })).toContain('hasCode must be true');
  });

  it.each(PLUGIN_ISSUE_CODES)('describes %s', (code) => {
    expect(issue(code)).toMatch(/^sheets\/a\.json: .+[a-z]/);
  });

  it.each([
    [{ reason: 'type', expected: 'string' }, 'Expected string'],
    [{ reason: 'too_small', origin: 'string', minimum: 1 }, 'Must be at least 1 characters'],
    [{ reason: 'too_big', origin: 'array', maximum: 3 }, 'Must be at most 3 items'],
    [{ reason: 'too_big', origin: 'number', maximum: 3 }, 'Must be at most 3'],
    [{ reason: 'enum', values: '"a", "b"' }, 'Expected one of "a", "b"'],
    [{ reason: 'invalid_format' }, 'Does not have the expected format'],
    [{ reason: 'custom' }, 'Invalid value'],
  ])('words invalid values %j', (params, text) => {
    expect(issue('invalid_value', params)).toBe(`sheets/a.json: ${text}`);
  });
});
