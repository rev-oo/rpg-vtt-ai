// Pre-commit checks on staged files (specs §6.4). ESLint picks up each package's own config.
export default {
  '*.{ts,tsx,mts,cts,js,mjs,cjs}': [
    'eslint --max-warnings 0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,md,css,yml,yaml}': 'prettier --write',
};
