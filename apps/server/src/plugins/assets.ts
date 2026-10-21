import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * The file types plugins may serve (T-0405). Anything else, including TypeScript sources and
 * HTML, is not served at all.
 */
export const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export interface PluginAsset {
  /** Absolute path of the file on disk. */
  file: string;
  /** The path inside the plugin folder, `/`-separated (`styles/sheet.css`). */
  relative: string;
  type: string;
  size: number;
  mtimeMs: number;
}

/**
 * Finds a file a plugin may serve, or undefined. The request path must name a regular file
 * inside the plugin folder: no `.` or `..` segments, no hidden files, no backslashes or NUL,
 * an allowed type, and no symbolic link anywhere on the way out of the folder.
 */
export async function findPluginAsset(
  pluginDir: string,
  requestPath: string,
): Promise<PluginAsset | undefined> {
  if (/[\\\0]/.test(requestPath)) return undefined;
  const segments = requestPath.split('/');
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return undefined;
  const relative = segments.join('/');
  const type = ASSET_TYPES[path.extname(relative).toLowerCase()];
  if (!type) return undefined;

  try {
    const root = await realpath(pluginDir);
    const file = path.join(root, ...segments);
    // realpath resolves every link; the file must still be inside the plugin folder.
    if ((await realpath(file)) !== file) return undefined;
    const stats = await lstat(file);
    if (!stats.isFile()) return undefined;
    return { file, relative, type, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}
