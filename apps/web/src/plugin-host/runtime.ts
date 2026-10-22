import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

import * as sdkClient from '@vtt/sdk/client';

import { RUNTIME_GLOBAL, type SharedModule } from './shared-modules.js';

const modules: Record<SharedModule, unknown> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@vtt/sdk/client': sdkClient,
};

/** Makes the app's React and SDK available to plugin code, once. */
export function installPluginRuntime(): void {
  const scope = globalThis as Record<string, unknown>;
  scope[RUNTIME_GLOBAL] ??= modules;
}
