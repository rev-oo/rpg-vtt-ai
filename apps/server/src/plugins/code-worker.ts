// The worker thread that runs one plugin's `code/shared.js` and `code/server.js` (ADR-047).
// It imports only `node:` modules: tests run it from source through Node's type stripping, so
// it uses erasable TypeScript only. Messages are described in code-runtime.ts.

import { parentPort, workerData, type MessagePort } from 'node:worker_threads';

interface Setup {
  shared: string | null;
  server: string | null;
  /** Flag 0 of this array is set to 1 when a synchronous answer is posted on `syncPort`. */
  syncState: SharedArrayBuffer;
  syncPort: MessagePort;
}

type Callable = (...args: unknown[]) => unknown;
type Exports = Record<string, Callable>;

const port = parentPort;
if (!port) throw new Error('code-worker must run as a worker thread');
const setup = workerData as Setup;
const flag = new Int32Array(setup.syncState);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The name of errors thrown by `ctx.fail`, whose message the caller sees (ADR-048). */
const SHOWN = 'PluginFailure';
const shown = (error: unknown): boolean => error instanceof Error && error.name === SHOWN;

/** `definition[key]`, which must be an object of functions when present. */
function callables(definition: Record<string, unknown>, key: string, file: string): Exports {
  const value = definition[key];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${file}: "${key}" must be an object of functions`);
  }
  const result: Exports = {};
  for (const [name, fn] of Object.entries(value as Record<string, unknown>)) {
    if (typeof fn !== 'function') throw new Error(`${file}: ${key}.${name} is not a function`);
    result[name] = fn as Callable;
  }
  return result;
}

async function load(url: string | null, keys: readonly string[]): Promise<Record<string, Exports>> {
  const loaded: Record<string, Exports> = {};
  for (const key of keys) loaded[key] = {};
  if (url === null) return loaded;
  const file = new URL(url).pathname.split('/').slice(-2).join('/');
  const module = (await import(url)) as { default?: unknown };
  const definition = module.default;
  if (typeof definition !== 'object' || definition === null) {
    throw new Error(`${file}: the default export must be an object (defineShared or defineServer)`);
  }
  for (const key of keys) loaded[key] = callables(definition as Record<string, unknown>, key, file);
  return loaded;
}

let functions: Exports = {};
/** Runnable server code: `handlers` for recipes, `commands` and combat `hooks`. */
const runnable: Record<string, Exports> = { handler: {}, command: {}, hook: {} };

/** Pending `ctx` calls of running handlers, by sequence number. */
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (e: Error) => void }
>();
let sequence = 0;

function callHost(call: number, method: string, args: unknown[]): Promise<unknown> {
  sequence += 1;
  const seq = sequence;
  return new Promise((resolve, reject) => {
    pending.set(seq, { resolve, reject });
    port?.postMessage({ type: 'ctx', call, seq, method, args });
  });
}

function contextFor(call: number): unknown {
  return {
    roll: (formula: unknown) => callHost(call, 'roll', [formula]),
    chat: { post: (post: unknown) => callHost(call, 'post', [post]) },
    actors: {
      get: (id: unknown) => callHost(call, 'get', [id]),
      adjust: (id: unknown, path: unknown, delta: unknown) =>
        callHost(call, 'adjust', [id, path, delta]),
    },
    log: (text: unknown, data: unknown) => {
      port?.postMessage({ type: 'log', text: String(text), data: data ?? null });
    },
    fail: (text: unknown): never => {
      const error = new Error(String(text));
      error.name = SHOWN;
      throw error;
    },
  };
}

// Synchronous calls of shared functions: the main thread waits on the flag (ADR-047).
setup.syncPort.on('message', (request: { name: string; args: unknown[] }) => {
  let reply: { ok: true; value: unknown } | { ok: false; error: string };
  try {
    const fn = Object.hasOwn(functions, request.name) ? functions[request.name] : undefined;
    if (!fn) throw new Error(`there is no shared function "${request.name}"`);
    reply = { ok: true, value: fn(...request.args) };
  } catch (error) {
    reply = { ok: false, error: message(error) };
  }
  try {
    setup.syncPort.postMessage(reply);
  } catch {
    setup.syncPort.postMessage({ ok: false, error: 'the result cannot be sent' });
  }
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});

port.on(
  'message',
  (
    msg:
      | {
          type: 'handle';
          call: number;
          kind: 'handler' | 'command' | 'hook';
          name: string;
          input: Record<string, unknown>;
        }
      | { type: 'ctx-reply'; seq: number; ok: boolean; value?: unknown; error?: string },
  ) => {
    if (msg.type === 'ctx-reply') {
      const waiting = pending.get(msg.seq);
      pending.delete(msg.seq);
      if (msg.ok) waiting?.resolve(msg.value);
      else waiting?.reject(new Error(msg.error ?? 'failed'));
      return;
    }
    const { call, kind, name, input } = msg;
    const code = runnable[kind] ?? {};
    const handler = Object.hasOwn(code, name) ? code[name] : undefined;
    if (!handler) {
      port.postMessage({
        type: 'handled',
        call,
        ok: false,
        error: `there is no ${kind} "${name}"`,
      });
      return;
    }
    Promise.resolve()
      .then(() => handler({ ...input, ctx: contextFor(call) }))
      .then(
        (value: unknown) => {
          try {
            port.postMessage({ type: 'handled', call, ok: true, value });
          } catch {
            port.postMessage({
              type: 'handled',
              call,
              ok: false,
              error: 'the result cannot be sent',
            });
          }
        },
        (error: unknown) => {
          port.postMessage({
            type: 'handled',
            call,
            ok: false,
            error: message(error),
            shown: shown(error),
          });
        },
      );
  },
);

try {
  const shared = await load(setup.shared, ['functions']);
  const server = await load(setup.server, ['handlers', 'commands', 'hooks']);
  functions = shared.functions ?? {};
  runnable.handler = server.handlers ?? {};
  runnable.command = server.commands ?? {};
  runnable.hook = server.hooks ?? {};
  port.postMessage({
    type: 'ready',
    functions: Object.keys(functions),
    handlers: Object.keys(runnable.handler),
    commands: Object.keys(runnable.command),
    hooks: Object.keys(runnable.hook),
  });
} catch (error) {
  port.postMessage({ type: 'failed', error: message(error) });
}
