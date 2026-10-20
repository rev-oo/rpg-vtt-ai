import type { Config } from '@react-router/dev/config';

// SPA mode (ADR-013): the Fastify server serves the built files; there is no SSR.
export default {
  appDirectory: 'src',
  ssr: false,
} satisfies Config;
