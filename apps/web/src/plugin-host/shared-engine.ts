import type { QuickJSHandle } from 'quickjs-emscripten-core';

import type { FormulaFunction, Value } from '@vtt/formula';

// `code/shared` in the browser (T-1502, ADR-074): sheets call its functions from formulas,
// synchronously, so it runs in QuickJS, the engine the server runs it in (ADR-073), compiled
// to WebAssembly in this page. The engine has no DOM, no cookies and no network; values cross
// as JSON. The engine loads only for systems that have shared code.

/** How long one call may run in the engine before it is stopped. */
export const FUNCTION_TIME_LIMIT_MS = 100;
const MEMORY_BYTES = 32 * 1024 * 1024;
const STACK_BYTES = 512 * 1024;

/** The engine's WebAssembly bytes; tests read them from disk instead of fetching. */
export type WasmLoader = () => Promise<ArrayBuffer>;

const fetchWasm: WasmLoader = async () => {
  const { default: url } = await import('@jitl/quickjs-wasmfile-release-sync/wasm?url');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the formula engine did not load (${String(response.status)})`);
  return response.arrayBuffer();
};

let loadWasm: WasmLoader = fetchWasm;

/** Replaces how the engine's bytes are loaded; for tests. */
export function setWasmLoader(loader: WasmLoader | null): void {
  loadWasm = loader ?? fetchWasm;
}

async function newEngine() {
  const [{ newQuickJSWASMModuleFromVariant, newVariant }, { default: variant }] = await Promise.all(
    [import('quickjs-emscripten-core'), import('@jitl/quickjs-wasmfile-release-sync')],
  );
  return newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmBinary: () => loadWasm() }));
}

/**
 * Runs `source`, the text of `code/shared.js`, as a module in a new engine and returns its
 * functions, each called synchronously in the engine. Throws when the module fails or its
 * default export is not `defineShared({ functions })`.
 */
export async function sharedEngineFunctions(
  source: string,
): Promise<Readonly<Record<string, FormulaFunction>>> {
  const engine = await newEngine();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(STACK_BYTES);
  let deadline = Infinity;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();

  // The engine's JSON, taken before plugin code runs, carries values in and out.
  const json = vm.getProp(vm.global, 'JSON');
  const parse = vm.getProp(json, 'parse');
  const stringify = vm.getProp(json, 'stringify');
  json.dispose();
  const describe = vm.unwrapResult(
    vm.evalCode(`(value) => {
      if (typeof value !== 'object' || value === null) return null;
      const functions = value.functions;
      if (functions === undefined) return [];
      if (typeof functions !== 'object' || functions === null) return null;
      return Object.keys(functions).map((name) => [name, typeof functions[name]]);
    }`),
  );

  const errorOf = (handle: QuickJSHandle): Error => {
    const dumped: unknown = vm.dump(handle);
    handle.dispose();
    const message =
      typeof dumped === 'object' && dumped !== null && 'message' in dumped
        ? String(dumped.message)
        : String(dumped);
    return new Error(message);
  };

  const evaluated = vm.evalCode(source, 'code/shared.js', { type: 'module' });
  if (evaluated.error) throw errorOf(evaluated.error);
  const definition = vm.getProp(evaluated.value, 'default');
  evaluated.value.dispose();
  const listed = vm.unwrapResult(vm.callFunction(describe, vm.undefined, definition));
  const text = vm.callFunction(stringify, vm.undefined, listed);
  listed.dispose();
  const entries = JSON.parse(vm.getString(vm.unwrapResult(text))) as [string, string][] | null;
  if (!entries || entries.some(([, type]) => type !== 'function')) {
    definition.dispose();
    throw new Error('code/shared.js must export defineShared({ functions }) by default');
  }
  const holder = vm.getProp(definition, 'functions');
  definition.dispose();

  const functions: Record<string, FormulaFunction> = {};
  for (const [name] of entries) {
    const fn = vm.getProp(holder, name);
    functions[name] = (...args: Value[]): Value => {
      const handles = args.map((arg) => {
        const string = vm.newString(JSON.stringify(arg));
        const parsed = vm.unwrapResult(vm.callFunction(parse, vm.undefined, string));
        string.dispose();
        return parsed;
      });
      deadline = Date.now() + FUNCTION_TIME_LIMIT_MS;
      const result = vm.callFunction(fn, vm.undefined, ...handles);
      deadline = Infinity;
      for (const handle of handles) handle.dispose();
      if (result.error) throw errorOf(result.error);
      const out = vm.callFunction(stringify, vm.undefined, result.value);
      result.value.dispose();
      if (out.error) throw errorOf(out.error);
      const value: unknown =
        vm.typeof(out.value) === 'string' ? JSON.parse(vm.getString(out.value)) : undefined;
      out.value.dispose();
      // The evaluator checks what a function returns, as it does on the server.
      return value as Value;
    };
  }
  return functions;
}
