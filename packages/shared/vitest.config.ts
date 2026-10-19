import { defineVttVitestConfig } from '@vtt/config/vitest';

export default defineVttVitestConfig({
  coverageGate: { percent: 80, files: 'src/permissions/**' },
});
