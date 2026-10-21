import type { z } from 'zod';

import type { PluginFileKind } from '../json-schema.js';
import { UNSUPPORTED_KEYWORDS } from '../types.js';

import type { JsonPath, PluginIssue } from './issues.js';

type ZodIssue = z.core.$ZodIssue;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `path` inside parsed JSON, or undefined. */
export function valueAt(data: unknown, path: JsonPath): unknown {
  let value = data;
  for (const key of path) {
    if (typeof key === 'number')
      value = Array.isArray(value) ? (value as unknown[])[key] : undefined;
    else value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return value;
}

const toPath = (path: readonly PropertyKey[]): (string | number)[] =>
  path.map((key) => (typeof key === 'number' ? key : String(key)));

/** A union branch that failed on `type` is a node of another kind, not a broken one. */
const missesDiscriminator = (branch: readonly ZodIssue[]): boolean =>
  branch.some((issue) => issue.path.length === 1 && issue.path[0] === 'type');

/**
 * Turns the Zod issues of one file into plugin issues. Unions report the branch the value
 * was most likely meant to be, so a broken `field` node is not also listed as a bad custom one.
 */
export function shapeIssues(
  file: string,
  kind: PluginFileKind,
  data: unknown,
  issues: readonly ZodIssue[],
): PluginIssue[] {
  const result: PluginIssue[] = [];
  const add = (code: PluginIssue['code'], path: JsonPath, params: PluginIssue['params'] = {}) =>
    result.push({ severity: 'error', code, file, path: [...path], params });

  const visit = (issue: ZodIssue, base: JsonPath): void => {
    const path = [...base, ...toPath(issue.path)];
    const last = path.at(-1);
    const missing = path.length > 0 && valueAt(data, path) === undefined;
    if (missing && issue.code !== 'unrecognized_keys' && issue.code !== 'invalid_union') {
      add('missing_key', path, { key: String(last) });
      return;
    }
    switch (issue.code) {
      case 'invalid_union': {
        const branches = issue.errors;
        const matching = branches.filter((branch) => !missesDiscriminator(branch));
        if (branches.length === 0 || matching.length === 0) {
          const node = branches.length === 0 && last === 'type' ? path.slice(0, -1) : path;
          add('unknown_node', node, { type: String(valueAt(data, [...node, 'type'])) });
          return;
        }
        const best = matching.reduce((a, b) => (b.length < a.length ? b : a));
        best.forEach((inner) => {
          visit(inner, path);
        });
        return;
      }
      case 'invalid_type':
        add('invalid_value', path, { reason: 'type', expected: issue.expected });
        return;
      case 'unrecognized_keys':
        for (const key of issue.keys) {
          const unsupported =
            (kind === 'actor-type' || kind === 'item-type') &&
            path[0] === 'schema' &&
            (UNSUPPORTED_KEYWORDS as readonly string[]).includes(key);
          add(unsupported ? 'unsupported_keyword' : 'unknown_key', [...path, key], { key });
        }
        return;
      case 'invalid_key':
        add('invalid_name', path, { name: String(last), of: 'field' });
        return;
      case 'too_small':
        add('invalid_value', path, {
          reason: 'too_small',
          origin: issue.origin,
          minimum: Number(issue.minimum),
        });
        return;
      case 'too_big':
        add('invalid_value', path, {
          reason: 'too_big',
          origin: issue.origin,
          maximum: Number(issue.maximum),
        });
        return;
      case 'invalid_value':
        add('invalid_value', path, {
          reason: 'enum',
          values: issue.values.map((value) => JSON.stringify(value)).join(', '),
        });
        return;
      default:
        add('invalid_value', path, { reason: issue.code });
    }
  };

  issues.forEach((issue) => {
    visit(issue, []);
  });
  return result;
}
