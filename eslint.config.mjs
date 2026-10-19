import { defineVttConfig } from '@vtt/config/eslint';

// Root-level files only; every workspace package has its own eslint.config.mjs.
export default defineVttConfig(import.meta.dirname);
