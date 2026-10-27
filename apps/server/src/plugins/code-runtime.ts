import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

import type { FastifyBaseLogger } from 'fastify';

import type { FormulaFunction } from '@vtt/formula';
import { BUILT_IN_COMMANDS, COMMAND_NAME } from '@vtt/shared/api';

// Runs plugin `code/shared` and `code/server` in a worker thread per plugin (ADR-047, Q13).
//
// Messages, main → worker: `handle` (run a handler or command), `ctx-reply` (answer to a ctx call).
// Worker → main: `ready` / `failed` (after loading), `ctx` (a ctx call), `handled`, `log`.
// Shared functions are called synchronously over `syncPort`: the main thread posts the call and
// waits on a shared flag, which the worker sets once its answer is on the port.

/** How long a shared function may run before its worker is stopped. */
export const FUNCTION_TIME_LIMIT_MS = 100;
/** How long a handler or command may run in total, `ctx` calls included. */
export const HANDLER_TIME_LIMIT_MS = 5000;
const STARTUP_TIME_LIMIT_MS = 5000;
const HEAP_LIMIT_MB = 64;

export type CodeErrorCode = 'handler_failed' | 'handler_timeout' | 'plugin_code_failed';

export class PluginCodeError extends Error {
  constructor(
    readonly code: CodeErrorCode,
    message: string,
    /** The plugin failed on purpose with `ctx.fail`, so the caller may see `message`. */
    readonly shown = false,
  ) {
    super(message);
    this.name = 'PluginCodeError';
  }
}

/** Server code a member can run: a recipe's handler or a slash command (ADR-048). */
export type CodeKind = 'handler' | 'command';

/** What a handler's `ctx` calls do, answered on the main thread for the roll's sender. */
export type HandlerHost = (method: string, args: readonly unknown[]) => Promise<unknown>;

export interface LoadedCode {
  readonly functions: Readonly<Record<string, FormulaFunction>>;
  readonly handlers: readonly string[];
  /** Slash commands with valid names that are not built in (ADR-048). */
  readonly commands: readonly string[];
  /** Runs a handler or command; rejects with `PluginCodeError` when it fails or takes too long. */
  handle(
    kind: CodeKind,
    name: string,
    input: Readonly<Record<string, unknown>>,
    host: HandlerHost,
  ): Promise<void>;
}

interface Ready {
  functions: string[];
  handlers: string[];
  commands: string[];
}

type WorkerMessage =
  | { type: 'ready'; functions: string[]; handlers: string[]; commands: string[]; hooks: string[] }
  | { type: 'failed'; error: string }
  | { type: 'ctx'; call: number; seq: number; method: string; args: unknown[] }
  | { type: 'handled'; call: number; ok: boolean; error?: string; shown?: boolean }
  | { type: 'log'; text: string; data: unknown };

/** The worker's source next to this file: built `.js`, or `.ts` when tests run the sources. */
function workerUrl(): URL {
  const built = new URL('./code-worker.js', import.meta.url);
  return existsSync(built) ? built : new URL('./code-worker.ts', import.meta.url);
}

/** `items` split into those that pass `test` and those that do not. */
function partition<T>(items: readonly T[], test: (item: T) => boolean): [T[], T[]] {
  return [items.filter(test), items.filter((item) => !test(item))];
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One plugin's worker. It is replaced after it crashes or overruns a time limit. */
class PluginWorker implements LoadedCode {
  readonly functions: Readonly<Record<string, FormulaFunction>>;
  readonly handlers: readonly string[];
  readonly commands: readonly string[];
  #calls = 0;
  readonly #running = new Map<
    number,
    { resolve: () => void; reject: (error: PluginCodeError) => void; host: HandlerHost }
  >();

  constructor(
    private readonly worker: Worker,
    private readonly sync: { port: MessageChannel['port1']; flag: Int32Array },
    ready: Ready,
    private readonly stop: (reason: string) => void,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.functions = Object.fromEntries(ready.functions.map((name) => [name, this.#call(name)]));
    this.handlers = ready.handlers;
    const builtIn: readonly string[] = BUILT_IN_COMMANDS;
    const [commands, refused] = partition(
      ready.commands,
      (name) => COMMAND_NAME.test(name) && !builtIn.includes(name),
    );
    if (refused.length > 0) {
      logger.warn({ commands: refused }, 'plugin commands ignored: invalid or built-in names');
    }
    this.commands = commands;
    worker.on('message', (message: WorkerMessage) => {
      this.#receive(message);
    });
  }

  /** A synchronous shared function backed by the worker (ADR-047). */
  #call(name: string): FormulaFunction {
    return (...args) => {
      const { port, flag } = this.sync;
      Atomics.store(flag, 0, 0);
      port.postMessage({ name, args });
      if (Atomics.wait(flag, 0, 0, FUNCTION_TIME_LIMIT_MS) === 'timed-out') {
        this.stop(`${name}() took longer than ${String(FUNCTION_TIME_LIMIT_MS)} ms`);
        throw new Error(`it took longer than ${String(FUNCTION_TIME_LIMIT_MS)} ms`);
      }
      const reply = receiveMessageOnPort(port)?.message as
        { ok: true; value: unknown } | { ok: false; error: string } | undefined;
      if (!reply) throw new Error('the plugin code did not answer');
      if (!reply.ok) throw new Error(reply.error);
      return reply.value;
    };
  }

  handle(
    kind: CodeKind,
    name: string,
    input: Readonly<Record<string, unknown>>,
    host: HandlerHost,
  ): Promise<void> {
    this.#calls += 1;
    const call = this.#calls;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop(`the ${kind} "${name}" took longer than ${String(HANDLER_TIME_LIMIT_MS)} ms`);
      }, HANDLER_TIME_LIMIT_MS);
      const settle = () => {
        clearTimeout(timer);
        this.#running.delete(call);
      };
      this.#running.set(call, {
        resolve: () => {
          settle();
          resolve();
        },
        reject: (error) => {
          settle();
          reject(error);
        },
        host,
      });
      this.worker.postMessage({ type: 'handle', call, kind, name, input });
    });
  }

  /** Rejects every running handler; the worker is gone. */
  fail(code: CodeErrorCode, reason: string): void {
    for (const running of this.#running.values()) running.reject(new PluginCodeError(code, reason));
  }

  /** Stops the worker, failing what still runs on it. */
  async close(reason: string): Promise<void> {
    this.fail('plugin_code_failed', reason);
    this.sync.port.close();
    await this.worker.terminate();
  }

  #receive(message: WorkerMessage): void {
    switch (message.type) {
      case 'handled': {
        const running = this.#running.get(message.call);
        if (message.ok) running?.resolve();
        else {
          const error = message.error ?? 'failed';
          running?.reject(new PluginCodeError('handler_failed', error, message.shown === true));
        }
        return;
      }
      case 'ctx': {
        const running = this.#running.get(message.call);
        const reply = (answer: { ok: boolean; value?: unknown; error?: string }) => {
          this.worker.postMessage({ type: 'ctx-reply', seq: message.seq, ...answer });
        };
        if (!running) {
          reply({ ok: false, error: 'the handler has finished' });
          return;
        }
        running.host(message.method, message.args).then(
          (value) => {
            reply({ ok: true, value });
          },
          (error: unknown) => {
            reply({ ok: false, error: errorText(error) });
          },
        );
        return;
      }
      case 'log':
        this.logger.info({ data: message.data }, message.text);
        return;
      default:
        return;
    }
  }
}

export interface CodeRuntimeOptions {
  /** `DATA_DIR/plugins`. */
  dir: string;
  logger: FastifyBaseLogger;
}

/**
 * The workers of the plugins whose code has run since the last scan. A plugin's worker starts
 * on first use and is stopped by `reset()` (after a scan) or when it fails.
 */
export class PluginCodeRuntime {
  readonly #workers = new Map<string, Promise<PluginWorker>>();

  constructor(private readonly options: CodeRuntimeOptions) {}

  /**
   * The loaded code of a plugin with `code/shared.js` or `code/server.js` among `entries`, or
   * `undefined` when it has neither. Rejects with `PluginCodeError` when the code fails to load.
   */
  async load(id: string, entries: readonly string[]): Promise<LoadedCode | undefined> {
    const shared = entries.includes('code/shared.js');
    const server = entries.includes('code/server.js');
    if (!shared && !server) return undefined;
    let worker = this.#workers.get(id);
    if (!worker) {
      worker = this.#start(id, { shared, server });
      this.#workers.set(id, worker);
      worker.catch(() => this.#workers.delete(id));
    }
    return worker;
  }

  /** Stops every worker; plugins load their code again on next use. */
  reset(): Promise<void> {
    const workers = [...this.#workers.values()];
    this.#workers.clear();
    return Promise.all(
      workers.map((pending) =>
        pending.then(
          (worker) => worker.close('the plugin was reloaded'),
          () => undefined,
        ),
      ),
    ).then(() => undefined);
  }

  #start(id: string, has: { shared: boolean; server: boolean }): Promise<PluginWorker> {
    const { dir, logger } = this.options;
    const url = (file: string) => pathToFileURL(path.join(dir, id, 'code', file)).href;
    const log = logger.child({ plugin: id });
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const channel = new MessageChannel();
    const worker = new Worker(workerUrl(), {
      workerData: {
        shared: has.shared ? url('shared.js') : null,
        server: has.server ? url('server.js') : null,
        syncState: flag.buffer,
        syncPort: channel.port2,
      },
      transferList: [channel.port2],
      // The server's own Node flags, such as --inspect, are not the plugin's.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: HEAP_LIMIT_MB },
      stdout: true,
      stderr: true,
    });
    worker.unref();
    // Plugin `console` output goes to the server log.
    worker.stdout.on('data', (chunk: Buffer) => {
      log.info({ output: chunk.toString().trimEnd() }, 'plugin code output');
    });
    worker.stderr.on('data', (chunk: Buffer) => {
      log.warn({ output: chunk.toString().trimEnd() }, 'plugin code output');
    });

    const started = new Promise<PluginWorker>((resolve, reject) => {
      let loaded: PluginWorker | undefined;
      const stop = (reason: string, code: CodeErrorCode = 'handler_timeout') => {
        log.warn({ reason }, 'plugin code stopped');
        // Only this worker's entry: a newer one may have started since.
        if (this.#workers.get(id) === started) this.#workers.delete(id);
        loaded?.fail(code, reason);
        channel.port1.close();
        void worker.terminate();
      };
      const startup = setTimeout(() => {
        stop('the code took too long to load', 'plugin_code_failed');
        reject(new PluginCodeError('plugin_code_failed', 'The plugin code took too long to load.'));
      }, STARTUP_TIME_LIMIT_MS);
      worker.on('error', (error) => {
        clearTimeout(startup);
        log.error({ err: error }, 'plugin code crashed');
        stop(errorText(error), 'handler_failed');
        reject(new PluginCodeError('plugin_code_failed', errorText(error)));
      });
      worker.once('message', (message: WorkerMessage) => {
        clearTimeout(startup);
        if (message.type !== 'ready') {
          const reason = message.type === 'failed' ? message.error : 'unexpected message';
          log.error({ reason }, 'plugin code failed to load');
          channel.port1.close();
          void worker.terminate();
          reject(new PluginCodeError('plugin_code_failed', reason));
          return;
        }
        log.info(
          { functions: message.functions, handlers: message.handlers, commands: message.commands },
          'plugin code loaded',
        );
        loaded = new PluginWorker(worker, { port: channel.port1, flag }, message, stop, log);
        resolve(loaded);
      });
    });
    return started;
  }
}
