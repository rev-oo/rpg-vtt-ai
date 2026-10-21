import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  CSS_SCOPE_VERSION,
  PLUGIN_ISSUE_CODES,
  scopeCss,
  type ScopedCss,
} from '@vtt/plugin-schema';
import { pluginIssueSchema } from '@vtt/shared/api';

const cachedSchema = z.object({
  css: z.string(),
  issues: z.array(pluginIssueSchema.extend({ code: z.enum(PLUGIN_ISSUE_CODES) })),
});

/**
 * Scoped plugin CSS (§8.6) cached on disk, so each stylesheet is processed once per content.
 * The key hashes the processor version, the plugin, the file and its text, so an edited file
 * or a new processor never reads a stale entry.
 */
export class ScopedCssCache {
  readonly #dir: string;

  /** `dir` is usually `DATA_DIR/cache/css`. */
  constructor(dir: string) {
    this.#dir = dir;
  }

  async get(pluginId: string, file: string, source: string): Promise<ScopedCss> {
    const key = createHash('sha256')
      .update([String(CSS_SCOPE_VERSION), pluginId, file, source].join('\0'))
      .digest('hex');
    const entry = path.join(this.#dir, `${key}.json`);
    try {
      const cached = cachedSchema.safeParse(JSON.parse(await readFile(entry, 'utf8')));
      if (cached.success) return cached.data;
    } catch {
      // Missing or unreadable: process the file again below.
    }
    const scoped = scopeCss(source, { pluginId, file });
    await mkdir(this.#dir, { recursive: true });
    // Written beside the entry and renamed, so a reader never sees half a file.
    const temporary = `${entry}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(scoped));
    await rename(temporary, entry);
    return scoped;
  }
}
