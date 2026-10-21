import postcss, { CssSyntaxError, type AtRule, type Plugin, type Root } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';

import type { PluginIssue } from '../validate/issues.js';

// Scoped plugin CSS (specs §8.6, T-0404). Plugin styles may only reach the plugin's own
// sheets: every selector is scoped to `[data-plugin="<id>"]`, everything sits in
// `@layer plugin`, and anything that could leak out is stripped with a warning.

/** The loader refuses CSS files larger than this (§8.6). */
export const MAX_CSS_BYTES = 256 * 1024;

/** Bump when the output changes, so caches keyed by content drop old results. */
export const CSS_SCOPE_VERSION = 1;

const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'font-face']);
const KEYFRAMES = /^(?:-webkit-)?keyframes$/i;
const DOCUMENT_TAGS = new Set(['html', 'body']);

export interface ScopeOptions {
  pluginId: string;
  /** The file inside the plugin folder (`styles/sheet.css`); relative URLs resolve from it. */
  file: string;
}

export interface ScopedCss {
  css: string;
  issues: PluginIssue[];
}

const utf8Length = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/**
 * Where a `url()` inside the plugin points, as a path under `/plugins/<id>/`, or undefined
 * for URLs that leave the plugin folder. `data:` URLs are kept as they are.
 */
function resolveUrl(url: string, { pluginId, file }: ScopeOptions): string | undefined {
  if (/^data:/i.test(url)) return url;
  if (url === '' || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.includes('\\')) {
    return undefined;
  }
  const split = url.search(/[?#]/);
  const [target, suffix] = split < 0 ? [url, ''] : [url.slice(0, split), url.slice(split)];
  const parts = file.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') {
      if (parts.pop() === undefined) return undefined;
    } else if (segment !== '.' && segment !== '') {
      parts.push(segment);
    }
  }
  if (parts.length === 0) return undefined;
  return `/plugins/${pluginId}/${parts.map(encodeURIComponent).join('/')}${suffix}`;
}

/** The PostCSS plugin behind `scopeCss`; issues go to `report`. */
export function scopePluginCss(
  options: ScopeOptions,
  report: (issue: PluginIssue) => void,
): Plugin {
  const { pluginId, file } = options;
  const scope = `[data-plugin="${pluginId}"]`;
  const strip = (rule: string, line: number | undefined) => {
    report({
      severity: 'warning',
      code: 'css_stripped',
      file,
      path: [],
      params: { rule, line: line ?? 0 },
    });
  };
  const attribute = () => {
    const node = selectorParser.attribute({
      attribute: 'data-plugin',
      operator: '=',
      value: pluginId,
      quoteMark: '"',
      raws: {},
    });
    // The constructor drops the quotes; setValue keeps them.
    node.setValue(pluginId, { quoteMark: '"' });
    return node;
  };

  return {
    postcssPlugin: 'vtt-scope-plugin-css',
    Once(root: Root) {
      // At-rules: keep a short list; rename keyframes with the plugin id.
      const keyframes = new Set<string>();
      root.walkAtRules((atRule) => {
        const name = atRule.name.toLowerCase();
        if (KEYFRAMES.test(name)) {
          keyframes.add(atRule.params.trim());
          atRule.params = `${pluginId}--${atRule.params.trim()}`;
        } else if (name === 'charset') {
          // Harmless, and meaningless once the file is served inside the app.
          atRule.remove();
        } else if (!ALLOWED_AT_RULES.has(name)) {
          strip(`@${atRule.name}`, atRule.source?.start?.line);
          atRule.remove();
        }
      });

      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && KEYFRAMES.test((rule.parent as AtRule).name)) return;
        // Set inside walk callbacks, which TypeScript does not follow, hence objects.
        const found = { root: false };
        const dropped: string[] = [];
        rule.selector = selectorParser((selectors) => {
          selectors.each((selector) => {
            const tags = { document: false };
            selector.walkTags((tag) => {
              if (DOCUMENT_TAGS.has(tag.value.toLowerCase())) tags.document = true;
            });
            if (tags.document) {
              dropped.push(selector.toString().trim());
              selector.remove();
              return;
            }
            const root = { atTop: false };
            selector.walkPseudos((pseudo) => {
              if (pseudo.value.toLowerCase() !== ':root') return;
              if (pseudo.parent === selector) root.atTop = true;
              pseudo.replaceWith(attribute());
            });
            found.root ||= root.atTop;
            const first = selector.first;
            first.spaces.before = '';
            if (!root.atTop) {
              selector.prepend(selectorParser.combinator({ value: ' ' }));
              selector.prepend(attribute());
            }
          });
        }).processSync(rule.selector);
        for (const selector of dropped) strip(selector, rule.source?.start?.line);
        if (rule.selector.trim() === '') {
          rule.remove();
          return;
        }
        // :root may override tokens, but not stack itself above the app (§8.6).
        if (found.root) {
          rule.walkDecls(/^z-index$/i, (decl) => {
            strip(`:root { ${decl.prop} }`, decl.source?.start?.line);
            decl.remove();
          });
        }
      });

      root.walkDecls((decl) => {
        const value = valueParser(decl.value);
        const url = { leaves: false };
        value.walk((node) => {
          if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
          const [argument] = node.nodes;
          const resolved = resolveUrl(argument?.value.trim() ?? '', options);
          if (resolved === undefined) {
            url.leaves = true;
          } else {
            node.nodes = [
              { type: 'string', value: resolved, quote: '"' } as valueParser.StringNode,
            ];
          }
          return false;
        });
        if (url.leaves) {
          strip(`${decl.prop}: ${decl.value}`, decl.source?.start?.line);
          decl.remove();
          return;
        }
        if (/^(?:-webkit-)?animation(?:-name)?$/i.test(decl.prop) && keyframes.size > 0) {
          value.walk((node) => {
            if (node.type === 'word' && keyframes.has(node.value))
              node.value = `${pluginId}--${node.value}`;
          });
        }
        decl.value = valueParser.stringify(value.nodes);
      });

      // Rules left without declarations, and fonts without a source, do nothing.
      root.walkRules((rule) => {
        if (rule.nodes.length === 0) rule.remove();
      });
      root.walkAtRules(/^font-face$/i, (atRule) => {
        const font = { hasSource: false };
        atRule.walkDecls(/^src$/i, () => {
          font.hasSource = true;
        });
        if (!font.hasSource) atRule.remove();
      });

      const layer = postcss.atRule({ name: 'layer', params: 'plugin' });
      layer.append(root.nodes);
      layer.raws.after = '\n';
      root.removeAll();
      root.append(layer);
      // Outside the layer, so plugin rules cannot undo it (§8.6).
      root.append(
        postcss.rule({
          raws: { before: '\n', between: ' ', semicolon: true, after: ' ' },
          selector: scope,
          nodes: [postcss.decl({ prop: 'contain', value: 'layout paint' })],
        }),
      );
    },
  };
}

/**
 * Scopes one plugin stylesheet (specs §8.6). Errors (too large, does not parse) return no CSS;
 * stripped rules are warnings.
 */
export function scopeCss(source: string, options: ScopeOptions): ScopedCss {
  const issues: PluginIssue[] = [];
  const error = (code: PluginIssue['code'], params: PluginIssue['params']): ScopedCss => ({
    css: '',
    issues: [{ severity: 'error', code, file: options.file, path: [], params }],
  });
  if (utf8Length(source) > MAX_CSS_BYTES) return error('css_too_large', { limit: MAX_CSS_BYTES });
  try {
    const result = postcss([scopePluginCss(options, (issue) => issues.push(issue))]).process(
      source,
      {
        from: options.file,
      },
    );
    return { css: result.css, issues };
  } catch (cause) {
    if (!(cause instanceof CssSyntaxError)) throw cause;
    return error('css_invalid', {
      detail: cause.reason,
      line: cause.line ?? 0,
      column: cause.column ?? 0,
    });
  }
}
