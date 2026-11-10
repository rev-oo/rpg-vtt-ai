// The worker thread that runs one plugin's `code/shared.js` and `code/server.js` (ADR-047).
// The plugin code itself runs in QuickJS, a separate JavaScript engine compiled to WebAssembly
// (ADR-073): no Node object exists inside it, so `require`, `process`, the filesystem and the
// network are out of its reach. Values cross as JSON, and `ctx` is the only way out.
//
// Tests run this file from source through Node's type stripping, so it uses erasable TypeScript
// only. Messages are described in code-runtime.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';

import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from 'quickjs-emscripten-core';

interface Setup {
  shared: string | null;
  server: string | null;
  /** Flag 0 of this array is set to 1 when a synchronous answer is posted on `syncPort`. */
  syncState: SharedArrayBuffer;
  syncPort: MessagePort;
  limits: {
    /**
     * Interpreter time per shared function call, and per run of handler code: a backstop
     * behind the main thread's own time limits, which stop the worker first.
     */
    functionMs: number;
    handlerMs: number;
    memoryBytes: number;
    stackBytes: number;
  };
}

const port = parentPort;
if (!port) throw new Error('code-worker must run as a worker thread');
const setup = workerData as Setup;
const flag = new Int32Array(setup.syncState);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The name of errors thrown by `ctx.fail`, whose message the caller sees (ADR-048). */
const SHOWN = 'PluginFailure';

// The release build without asyncify, with its own .wasm file.
const engine = await newQuickJSWASMModuleFromVariant(import('@jitl/quickjs-wasmfile-release-sync'));
const runtime = engine.newRuntime();
runtime.setMemoryLimit(setup.limits.memoryBytes);
runtime.setMaxStackSize(setup.limits.stackBytes);
/** When the interpreter stops the code it runs; set before each entry into it. */
let deadline = Infinity;
runtime.setInterruptHandler(() => Date.now() > deadline);
const vm: QuickJSContext = runtime.newContext();

/** Runs `run` with an interpreter time budget. */
function within<T>(ms: number, run: () => T): T {
  deadline = Date.now() + ms;
  try {
    return run();
  } finally {
    deadline = Infinity;
  }
}

/** Runs the promise jobs that settled handles left, such as code after an `await`. */
function drain(): void {
  within(setup.limits.handlerMs, () => {
    const result = runtime.executePendingJobs();
    if (result.error) result.error.dispose();
  });
}

const json = vm.getProp(vm.global, 'JSON');
const parse = vm.getProp(json, 'parse');
const stringify = vm.getProp(json, 'stringify');
json.dispose();

/** A host value inside the engine, copied through JSON. */
function toVm(value: unknown): QuickJSHandle {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) return vm.undefined;
  const string = vm.newString(text);
  const parsed = vm.unwrapResult(vm.callFunction(parse, vm.undefined, string));
  string.dispose();
  return parsed;
}

/** An engine value on the host, copied through JSON; functions and the like do not cross. */
function fromVm(handle: QuickJSHandle): unknown {
  const result = vm.callFunction(stringify, vm.undefined, handle);
  if (result.error) {
    result.error.dispose();
    throw new Error('the result cannot be sent');
  }
  const text = result.value;
  const value: unknown = vm.typeof(text) === 'string' ? JSON.parse(vm.getString(text)) : undefined;
  text.dispose();
  return value;
}

/** The message of an error thrown inside the engine, and whether it came from `ctx.fail`. */
function failure(handle: QuickJSHandle): { error: string; shown: boolean } {
  const dumped: unknown = vm.dump(handle);
  handle.dispose();
  if (typeof dumped === 'object' && dumped !== null) {
    const { name, message: text } = dumped as { name?: unknown; message?: unknown };
    const error = typeof text === 'string' ? text : typeof name === 'string' ? name : 'failed';
    return { error, shown: name === SHOWN };
  }
  return { error: String(dumped), shown: false };
}

/** Pending `ctx` calls of running handlers, by sequence number. */
const pending = new Map<number, QuickJSDeferredPromise>();
let sequence = 0;

// What the bootstrap below closes over: plugin code never sees these names.
const hostCall = vm.newFunction('host', (callHandle, methodHandle, argsHandle) => {
  const call = vm.getNumber(callHandle);
  const method = vm.getString(methodHandle);
  const args = fromVm(argsHandle);
  sequence += 1;
  const deferred = vm.newPromise();
  pending.set(sequence, deferred);
  deferred.settled.then(drain, drain);
  port.postMessage({ type: 'ctx', call, seq: sequence, method, args });
  return deferred.handle;
});
const hostLog = vm.newFunction('log', (textHandle, dataHandle) => {
  port.postMessage({
    type: 'log',
    text: vm.getString(textHandle),
    data: fromVm(dataHandle) ?? null,
  });
});
// `console` goes to the worker's output, which the server logs (ADR-047).
const hostOutput = vm.newFunction('output', (levelHandle, textHandle) => {
  const stream = vm.getString(levelHandle) === 'error' ? process.stderr : process.stdout;
  stream.write(`${vm.getString(textHandle)}\n`);
});

/**
 * Builds `console` and returns the `ctx` factory, in the engine. Each `ctx` carries its call
 * number in a closure, so code cannot speak for another call.
 */
const BOOTSTRAP = `(host, log, output) => {
  const text = (values) => values.map((value) => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' ');
  const write = (level) => (...values) => { output(level, text(values)); };
  globalThis.console = Object.freeze({
    log: write('log'), info: write('log'), debug: write('log'),
    warn: write('error'), error: write('error'),
  });
  return (call) => Object.freeze({
    roll: (formula) => host(call, 'roll', [formula]),
    chat: Object.freeze({ post: (post) => host(call, 'post', [post]) }),
    actors: Object.freeze({
      get: (id) => host(call, 'get', [id]),
      adjust: (id, path, delta) => host(call, 'adjust', [id, path, delta]),
      set: (id, path, value) => host(call, 'set', [id, path, value]),
    }),
    items: Object.freeze({
      adjust: (id, path, delta) => host(call, 'adjustItem', [id, path, delta]),
    }),
    log: (message, data) => { log(String(message), data === undefined ? null : data); },
    fail: (message) => {
      const error = new Error(String(message));
      error.name = ${JSON.stringify(SHOWN)};
      throw error;
    },
  });
}`;
const bootstrap = vm.unwrapResult(vm.evalCode(BOOTSTRAP, 'vtt:bootstrap'));
const contextFor = vm.unwrapResult(
  vm.callFunction(bootstrap, vm.undefined, hostCall, hostLog, hostOutput),
);
for (const handle of [bootstrap, hostCall, hostLog, hostOutput]) handle.dispose();

/** A plugin's functions by name, from an object export such as `handlers`. */
type Callables = Map<string, QuickJSHandle>;

/**
 * The keys of an object and the type of each value, or `null` when it is not a plain object.
 * Made before plugin code runs, from the engine's own built-ins.
 */
const describe = vm.unwrapResult(
  vm.evalCode(`(value) => typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.keys(value).map((key) => [key, typeof value[key]])
    : null`),
);

function shape(handle: QuickJSHandle): [string, string][] | null {
  const result = vm.unwrapResult(vm.callFunction(describe, vm.undefined, handle));
  const value = fromVm(result) as [string, string][] | null;
  result.dispose();
  return value;
}

/** `definition[key]`, which must be an object of functions when present. */
function callables(definition: QuickJSHandle, key: string, file: string): Callables {
  const result: Callables = new Map();
  const value = vm.getProp(definition, key);
  try {
    if (vm.typeof(value) === 'undefined') return result;
    const entries = shape(value);
    if (!entries) throw new Error(`${file}: "${key}" must be an object of functions`);
    for (const [name, type] of entries) {
      if (type !== 'function') throw new Error(`${file}: ${key}.${name} is not a function`);
      result.set(name, vm.getProp(value, name));
    }
    return result;
  } finally {
    value.dispose();
  }
}

/**
 * Evaluates a code entry as an ES module and reads the objects of functions under `keys` from
 * its default export. Modules cannot import anything: the engine has no module loader.
 */
function load(url: string | null, keys: readonly string[]): Record<string, Callables> {
  const loaded: Record<string, Callables> = {};
  for (const key of keys) loaded[key] = new Map();
  if (url === null) return loaded;
  const file = new URL(url).pathname.split('/').slice(-2).join('/');
  const source = readFileSync(fileURLToPath(url), 'utf8');
  const evaluated = within(setup.limits.handlerMs, () =>
    vm.evalCode(source, file, { type: 'module' }),
  );
  if (evaluated.error) throw new Error(`${file}: ${failure(evaluated.error).error}`);
  const namespace = evaluated.value;
  const definition = vm.getProp(namespace, 'default');
  namespace.dispose();
  try {
    if (!shape(definition)) {
      throw new Error(
        `${file}: the default export must be an object (defineShared or defineServer)`,
      );
    }
    for (const key of keys) loaded[key] = callables(definition, key, file);
    return loaded;
  } finally {
    definition.dispose();
  }
}

let functions: Callables = new Map();
/** Runnable server code: `handlers` for recipes, `commands` and combat `hooks`. */
const runnable: Record<string, Callables> = {
  handler: new Map(),
  command: new Map(),
  hook: new Map(),
};

// Synchronous calls of shared functions: the main thread waits on the flag (ADR-047).
setup.syncPort.on('message', (request: { name: string; args: unknown[] }) => {
  let reply: { ok: true; value: unknown } | { ok: false; error: string };
  try {
    const fn = functions.get(request.name);
    if (!fn) throw new Error(`there is no shared function "${request.name}"`);
    const args = request.args.map(toVm);
    const result = within(setup.limits.functionMs, () =>
      vm.callFunction(fn, vm.undefined, ...args),
    );
    for (const arg of args) arg.dispose();
    if (result.error) throw new Error(failure(result.error).error);
    const value = fromVm(result.value);
    result.value.dispose();
    reply = { ok: true, value };
  } catch (error) {
    reply = { ok: false, error: message(error) };
  }
  setup.syncPort.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});

type Settled = { ok: true; value: unknown } | { ok: false; error: string; shown: boolean };

/** Runs a handler, command or hook, settling with what it returned or why it failed. */
async function run(
  fn: QuickJSHandle,
  kind: string,
  name: string,
  call: number,
  input: Record<string, unknown>,
): Promise<Settled> {
  const argument = toVm(input);
  // The migration hook works on data alone, so it gets no `ctx` (ADR-072).
  if (!(kind === 'hook' && name === 'migrate')) {
    const number = vm.newNumber(call);
    const ctx = vm.unwrapResult(vm.callFunction(contextFor, vm.undefined, number));
    number.dispose();
    vm.setProp(argument, 'ctx', ctx);
    ctx.dispose();
  }
  const started = within(setup.limits.handlerMs, () => vm.callFunction(fn, vm.undefined, argument));
  argument.dispose();
  if (started.error) return { ok: false, ...failure(started.error) };
  // Await what it returned, promise or not, inside the engine.
  const promise = started.value;
  const native = vm.resolvePromise(promise);
  promise.dispose();
  drain();
  const result = await native;
  if (result.error) return { ok: false, ...failure(result.error) };
  try {
    return { ok: true, value: fromVm(result.value) };
  } catch (error) {
    return { ok: false, error: message(error), shown: false };
  } finally {
    result.value.dispose();
  }
}

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
      if (!waiting) return;
      if (msg.ok) {
        const value = toVm(msg.value);
        waiting.resolve(value);
        value.dispose();
      } else {
        const error = vm.newError(msg.error ?? 'failed');
        waiting.reject(error);
        error.dispose();
      }
      waiting.dispose();
      return;
    }
    const { call, kind, name, input } = msg;
    const handler = runnable[kind]?.get(name);
    if (!handler) {
      port.postMessage({
        type: 'handled',
        call,
        ok: false,
        error: `there is no ${kind} "${name}"`,
      });
      return;
    }
    run(handler, kind, name, call, input).then(
      (settled) => {
        port.postMessage({ type: 'handled', call, ...settled });
      },
      (error: unknown) => {
        port.postMessage({ type: 'handled', call, ok: false, error: message(error) });
      },
    );
  },
);

try {
  const shared = load(setup.shared, ['functions']);
  const server = load(setup.server, ['handlers', 'commands', 'hooks']);
  functions = shared.functions ?? new Map<string, QuickJSHandle>();
  runnable.handler = server.handlers ?? new Map<string, QuickJSHandle>();
  runnable.command = server.commands ?? new Map<string, QuickJSHandle>();
  runnable.hook = server.hooks ?? new Map<string, QuickJSHandle>();
  port.postMessage({
    type: 'ready',
    functions: [...functions.keys()],
    handlers: [...runnable.handler.keys()],
    commands: [...runnable.command.keys()],
    hooks: [...runnable.hook.keys()],
  });
} catch (error) {
  port.postMessage({ type: 'failed', error: message(error) });
}
