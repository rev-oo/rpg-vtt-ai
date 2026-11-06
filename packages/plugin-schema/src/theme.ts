import { z } from 'zod';

import { schemaUrl } from './common.js';

// A module's `theme.json` (T-1602, ADR-076): the app's design tokens on the table page while
// the module is on. Values are checked here, so the CSS built from them cannot break out of
// its declarations: no `;`, braces, quotes outside font names, or `url()`.

/**
 * The table page's named parts (`data-vtt-part`), which module stylesheets style. They are a
 * stable API: a name is never reused for another part, and a removed part is kept named.
 */
export const VTT_PARTS = [
  'table',
  'table-header',
  'workspace',
  'tab',
  'panel',
  'chat',
  'chat-message',
  'chat-composer',
  'map',
  'map-toolbar',
  'sheet',
] as const;
export type VttPart = (typeof VTT_PARTS)[number];

/** `#rgb`, `#rrggbbaa`, a named colour, or a colour function of plain numbers. */
const COLOR =
  /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,30}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9a-z.%\s,/+-]{1,80}\))$/;
/** Font names, quoted or not, separated by commas. */
const FONT_LIST = /^[A-Za-z0-9 ,'"_-]{1,200}$/;
const FONT_NAME = /^[A-Za-z0-9 _-]{1,60}$/;
const LENGTH = /^(?:0|\d{1,3}(?:\.\d{1,3})?(?:px|rem|em))$/;
/** A file of the module, relative to its folder, without `..`. */
const FILE = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/;

export const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif)$/i;
export const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;

const color = z.string().regex(COLOR).meta({ title: 'Colour' });
const file = z.string().regex(FILE).meta({ title: 'Module file' });

/** The app's colour tokens (`--color-*` in `@vtt/ui`), by their names there in camel case. */
export const THEME_COLORS = [
  'canvas',
  'surface',
  'fg',
  'muted',
  'line',
  'primary',
  'primaryHover',
  'onPrimary',
  'danger',
  'dangerSoft',
  'infoSoft',
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

const colors = z
  .strictObject(Object.fromEntries(THEME_COLORS.map((key) => [key, color.optional()])))
  .describe('Colour tokens; any left out keep the app’s.') as z.ZodType<
  Partial<Record<ThemeColor, string>>
>;

const fontFace = z
  .strictObject({
    family: z.string().regex(FONT_NAME).describe('The name `font` and stylesheets use.'),
    src: file.describe('A `.woff2`, `.woff`, `.ttf` or `.otf` file of the module.'),
    weight: z
      .string()
      .regex(/^(?:normal|bold|[1-9]00(?: [1-9]00)?)$/)
      .optional(),
    style: z.enum(['normal', 'italic']).optional(),
  })
  .meta({ title: 'Font face' });

export const themeSchema = z
  .strictObject({
    ...schemaUrl,
    light: colors.optional().describe('Colours in the light scheme.'),
    dark: colors.optional().describe('Colours in the dark scheme.'),
    font: z
      .string()
      .regex(FONT_LIST)
      .optional()
      .describe('The text font, as a CSS font list such as `"IM Fell English", Georgia, serif`.'),
    radius: z
      .string()
      .regex(LENGTH)
      .optional()
      .describe(
        'The corner radius of cards, panels and inputs, such as `0` or `0.25rem`; smaller and larger corners scale with it.',
      ),
    fonts: z.array(fontFace).max(16).optional().describe('Fonts loaded from the module’s files.'),
    background: file
      .optional()
      .describe(
        'An image of the module tiled behind the table page, such as `images/paper.webp`. Parts with a colour of their own, such as panels, cover it unless the module’s styles clear it.',
      ),
  })
  .describe('A module’s theme: the app’s design tokens on the table page while the module is on.');
export type Theme = z.infer<typeof themeSchema>;

const cssVar = (key: ThemeColor) =>
  `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** The selector of everything a module styles: the page, only while the module is on. */
export const moduleScope = (pluginId: string): string => `:root[data-vtt-modules~="${pluginId}"]`;

/** `/plugins/<id>/<file>`, each segment encoded. */
const fileUrl = (pluginId: string, path: string) =>
  `/plugins/${pluginId}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** The radius scale of Tailwind, as multiples of `rounded-lg`. */
const RADII: readonly (readonly [string, number])[] = [
  ['xs', 0.25],
  ['sm', 0.5],
  ['md', 0.75],
  ['lg', 1],
  ['xl', 1.5],
  ['2xl', 2],
  ['3xl', 3],
];

/**
 * The CSS of a checked theme: its tokens on `moduleScope`, the dark ones in the dark scheme,
 * its fonts and background. Served as `/plugins/<id>/theme.css` (ADR-076).
 */
export function themeCss(theme: Theme, pluginId: string): string {
  const scope = moduleScope(pluginId);
  const block = (declarations: string[]) => declarations.map((line) => `  ${line};`).join('\n');
  const colorsOf = (set: Partial<Record<ThemeColor, string>> | undefined) =>
    THEME_COLORS.flatMap((key) => (set?.[key] ? [`${cssVar(key)}: ${set[key]}`] : []));
  const out: string[] = [];
  for (const face of theme.fonts ?? []) {
    out.push(
      `@font-face {\n${block([
        `font-family: "${face.family}"`,
        `src: url("${fileUrl(pluginId, face.src)}")`,
        `font-display: swap`,
        ...(face.weight ? [`font-weight: ${face.weight}`] : []),
        ...(face.style ? [`font-style: ${face.style}`] : []),
      ])}\n}`,
    );
  }
  const { font, radius } = theme;
  const always = [
    ...(font ? [`--font-sans: ${font}`] : []),
    ...(radius
      ? RADII.map(([size, scale]) => `--radius-${size}: calc(${radius} * ${String(scale)})`)
      : []),
  ];
  if (always.length > 0) out.push(`${scope} {\n${block(always)}\n}`);
  const light = colorsOf(theme.light);
  if (light.length > 0) {
    out.push(`@media not (prefers-color-scheme: dark) {\n${scope} {\n${block(light)}\n}\n}`);
  }
  const dark = colorsOf(theme.dark);
  if (dark.length > 0) {
    out.push(`@media (prefers-color-scheme: dark) {\n${scope} {\n${block(dark)}\n}\n}`);
  }
  if (theme.background) {
    out.push(
      `${scope} [data-vtt-part="table"] {\n${block([
        `background-image: url("${fileUrl(pluginId, theme.background)}")`,
      ])}\n}`,
    );
  }
  return `${out.join('\n')}\n`;
}
