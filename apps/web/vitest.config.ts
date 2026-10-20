import { defineVttVitestConfig } from '@vtt/config/vitest';

export default defineVttVitestConfig({ environment: 'jsdom', setupFiles: ['./test/setup.ts'] });
