import { parseArgs } from 'node:util';

import { packCommand } from './commands/pack.js';
import { schemaCommand } from './commands/schema.js';
import { validateCommand } from './commands/validate.js';
import { consoleOutput, UsageError, type Output } from './io.js';

export const USAGE = `Usage: vtt-plugin <command> [options]

Commands:
  validate <dir>                 Check a plugin folder as the server does
  dev <dir> [--port <n>]         Preview the plugin's sheets, reloading on changes
  pack <dir> [--out <file>]      Compile code/, minify styles and write a .vttplugin archive
  schema [--out <dir>]           Write the JSON Schemas of plugin files (or print them)
  help                           Show this help`;

const options = {
  out: { type: 'string', short: 'o' },
  port: { type: 'string', short: 'p' },
  help: { type: 'boolean', short: 'h' },
} as const;

function folder(positionals: readonly string[], command: string): string {
  const [dir, ...rest] = positionals;
  if (dir === undefined || rest.length > 0) {
    throw new UsageError(`${command} takes one plugin folder: vtt-plugin ${command} <dir>`);
  }
  return dir;
}

/** Runs the CLI and returns its exit code: 0 done, 1 the plugin has errors, 2 bad usage. */
export async function main(
  argv: readonly string[],
  output: Output = consoleOutput,
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args: [...argv], options, allowPositionals: true });
    const [command, ...rest] = positionals;
    if (values.help === true || command === undefined || command === 'help') {
      output.out(USAGE);
      return 0;
    }
    switch (command) {
      case 'validate':
        return await validateCommand(folder(rest, command), output);
      case 'pack':
        return await packCommand(folder(rest, command), values.out, output);
      case 'schema':
        if (rest.length > 0) throw new UsageError('schema takes no folder.');
        return await schemaCommand(values.out, output);
      case 'dev': {
        const port = values.port === undefined ? 5180 : Number(values.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new UsageError(`Not a port: ${values.port ?? ''}`);
        }
        // Vite loads only for the preview.
        const { devCommand } = await import('./commands/dev.js');
        return await devCommand(folder(rest, command), port, output);
      }
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      output.err(error.message);
      output.err(USAGE);
      return 2;
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      output.err(error.message);
      return 2;
    }
    throw error;
  }
}
