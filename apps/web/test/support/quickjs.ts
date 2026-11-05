import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { setWasmLoader } from '../../src/plugin-host/shared-engine.js';

/** Loads the formula engine's WebAssembly from disk, since tests replace `fetch`. */
export function loadEngineFromDisk(): void {
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const file = require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm');
  const bytes = readFileSync(file);
  setWasmLoader(() =>
    Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  );
}
