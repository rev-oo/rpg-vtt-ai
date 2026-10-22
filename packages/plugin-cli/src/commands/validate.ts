import { readPluginFolder } from '@vtt/plugin-io';
import {
  describePluginIssue,
  validatePlugin,
  type PluginIssue,
  type PluginValidation,
} from '@vtt/plugin-schema';

import type { Output } from '../io.js';

export interface CheckedPlugin extends PluginValidation {
  /** The folder's files for the validator (JSON and styles carry their text). */
  files: Map<string, string>;
  /** Every issue, the folder reader's included. */
  issues: PluginIssue[];
  errors: number;
}

/** Validates a plugin folder exactly as the server does on a scan (§8.13). */
export async function checkPlugin(dir: string): Promise<CheckedPlugin> {
  const folder = await readPluginFolder(dir);
  // No folder-name check: an install names the folder after the plugin id (ADR-026).
  const result = validatePlugin(folder.files);
  const issues = [...folder.issues, ...result.issues];
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { ...result, files: folder.files, issues, errors };
}

/** Prints the issues, errors first. */
export function printIssues(issues: readonly PluginIssue[], output: Output): void {
  const sorted = [...issues].sort(
    (a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning'),
  );
  for (const issue of sorted) {
    const line = `  ${issue.severity === 'error' ? 'error  ' : 'warning'} ${describePluginIssue(issue)}`;
    if (issue.severity === 'error') output.err(line);
    else output.out(line);
  }
}

/** `vtt-plugin validate <dir>`: exits 1 when the plugin has errors. */
export async function validateCommand(dir: string, output: Output): Promise<number> {
  const checked = await checkPlugin(dir);
  const name = checked.manifest ? `${checked.manifest.id} ${checked.manifest.version}` : dir;
  const warnings = checked.issues.length - checked.errors;
  printIssues(checked.issues, output);
  if (checked.errors > 0) {
    output.err(`${name}: ${String(checked.errors)} errors, ${String(warnings)} warnings`);
    return 1;
  }
  output.out(`${name}: valid${warnings > 0 ? `, ${String(warnings)} warnings` : ''}`);
  return 0;
}
