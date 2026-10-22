import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The sheet preview (T-0408): `pnpm --filter @vtt/sheet-renderer preview`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss()],
  server: { fs: { allow: ['../../..'] } },
});
