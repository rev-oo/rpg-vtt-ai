import { mergeConfig } from 'vitest/config';

import { defineVttVitestConfig } from '@vtt/config/vitest';

// The preview test reads plugin stylesheets as text, which Vitest leaves empty unless told.
export default mergeConfig(
  defineVttVitestConfig({ environment: 'jsdom', setupFiles: ['./test/setup.ts'] }),
  { test: { css: { include: [/plugins\/.+\.css/] } } },
);
