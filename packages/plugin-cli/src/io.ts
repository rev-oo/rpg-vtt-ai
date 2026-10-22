/** Where a command writes, so tests can capture it. */
export interface Output {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const consoleOutput: Output = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

/** A usage or input error; the CLI prints it and exits with 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}
