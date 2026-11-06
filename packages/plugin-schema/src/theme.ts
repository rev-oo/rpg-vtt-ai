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
const length = z.string().regex(LENGTH).meta({ title: 'Length' });

/**
 * The app's colour tokens (`--color-*` in `@vtt/ui`), by their names there in camel case, and
 * `panel`, the colour behind docked panels.
 */
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
  'panel',
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

/** What each colour token paints. */
const COLOR_USES: Readonly<Record<ThemeColor, string>> = {
  canvas: 'The page.',
  surface: 'Cards, inputs, menus and tab bars.',
  fg: 'Text.',
  muted: 'Secondary text, such as hints and times.',
  line: 'Borders and dividers.',
  primary: 'Buttons, links, focus rings and accents.',
  primaryHover: 'Buttons under the pointer.',
  onPrimary: 'Text on `primary`.',
  danger: 'Errors and destructive buttons.',
  dangerSoft: 'The background of error notices.',
  infoSoft: 'The background of notices and selected items.',
  panel: 'Docked panels; `canvas` by default. `transparent` shows the page’s `background`.',
};

const colors = z
  .strictObject(
    Object.fromEntries(
      THEME_COLORS.map((key) => [key, color.optional().describe(COLOR_USES[key])]),
    ),
  )
  .meta({ title: 'Colours' })
  .describe('Colour tokens; any left out keep the app’s.') as z.ZodType<
  Partial<Record<ThemeColor, string>>
>;

/** A density: how far apart things are, as a multiple of the app's spacing. */
const DENSITY_MIN = 0.75;
const DENSITY_MAX = 1.5;

const background = z.union([
  file,
  z
    .strictObject({
      light: file.optional().describe('The image in the light scheme.'),
      dark: file.optional().describe('The image in the dark scheme.'),
    })
    .meta({ title: 'Image per scheme' }),
]);

const fontFace = z
  .strictObject({
    family: z
      .string()
      .regex(FONT_NAME)
      .meta({ title: 'Font name' })
      .describe('The name `font` and stylesheets use.'),
    src: file.describe('A `.woff2`, `.woff`, `.ttf` or `.otf` file of the module.'),
    weight: z
      .string()
      .regex(/^(?:normal|bold|[1-9]00(?: [1-9]00)?)$/)
      .optional()
      .describe(
        'The weight this file draws, such as `400` or `bold`, or a range such as `100 900` for a variable font. Defaults to `normal`.',
      ),
    style: z
      .enum(['normal', 'italic'])
      .optional()
      .describe('Whether this file draws the italic. Defaults to `normal`.'),
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
      .meta({ title: 'Font list' })
      .optional()
      .describe('The text font, as a CSS font list such as `"IM Fell English", Georgia, serif`.'),
    radius: length
      .optional()
      .describe(
        'The corner radius of cards, panels and inputs, such as `0` or `0.25rem`; smaller and larger corners scale with it.',
      ),
    border: length
      .optional()
      .describe(
        'The width of the borders of cards, panels and inputs, such as `2px`; `0` for none.',
      ),
    density: z
      .number()
      .min(DENSITY_MIN)
      .max(DENSITY_MAX)
      .optional()
      .describe(
        `How far apart things are: paddings and gaps, as a multiple of the app’s (${String(DENSITY_MIN)}–${String(DENSITY_MAX)}). Below 1 is more compact, above 1 roomier.`,
      ),
    fonts: z.array(fontFace).max(16).optional().describe('Fonts loaded from the module’s files.'),
    background: background
      .optional()
      .describe(
        'An image of the module tiled behind the table page, such as `images/wood.webp`, or one per scheme (`{ "light": …, "dark": … }`). Docked panels cover it unless the theme’s `panel` colour lets it through, such as `transparent`.',
      ),
    panelBackground: background
      .optional()
      .describe(
        'An image of the module tiled inside panels, over the `panel` colour, such as `images/paper.webp`, or one per scheme.',
      ),
  })
  .describe('A module’s theme: the app’s design tokens on the table page while the module is on.');
export type Theme = z.infer<typeof themeSchema>;

const cssVar = (key: ThemeColor) =>
  key === 'panel'
    ? '--vtt-panel-background'
    : `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

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

/** The app's gaps between sheet nodes (`--vtt-gap-*` in `@vtt/ui`), which density scales too. */
const GAPS: readonly (readonly [string, number])[] = [
  ['sm', 0.5],
  ['md', 1],
  ['lg', 1.5],
];

/**
 * The CSS of a checked theme: its tokens on `moduleScope`, the colours and images of each
 * colour scheme in that scheme, and its fonts. Panels show `--vtt-panel-image`. Served as `/plugins/<id>/theme.css` (ADR-076).
 */
export function themeCss(theme: Theme, pluginId: string): string {
  const scope = moduleScope(pluginId);
  const block = (declarations: string[]) => declarations.map((line) => `  ${line};`).join('\n');
  const rule = (selector: string, declarations: string[]) =>
    `${selector} {\n${block(declarations)}\n}`;
  const out: string[] = [];
  for (const face of theme.fonts ?? []) {
    out.push(
      rule('@font-face', [
        `font-family: "${face.family}"`,
        `src: url("${fileUrl(pluginId, face.src)}")`,
        `font-display: swap`,
        ...(face.weight ? [`font-weight: ${face.weight}`] : []),
        ...(face.style ? [`font-style: ${face.style}`] : []),
      ]),
    );
  }
  const { font, radius, border, density } = theme;
  const always = [
    ...(font ? [`--font-sans: ${font}`] : []),
    ...(radius
      ? RADII.map(([size, scale]) => `--radius-${size}: calc(${radius} * ${String(scale)})`)
      : []),
    ...(border ? [`--vtt-border-width: ${border}`] : []),
    ...(density === undefined
      ? []
      : [
          `--spacing: calc(0.25rem * ${String(density)})`,
          ...GAPS.map(
            ([size, rem]) => `--vtt-gap-${size}: calc(${String(rem)}rem * ${String(density)})`,
          ),
        ]),
  ];
  /** The theme's image for both schemes, and for each scheme. */
  const images = (value: Theme['background']) =>
    typeof value === 'object'
      ? { both: undefined, light: value.light, dark: value.dark }
      : { both: value, light: undefined, dark: undefined };
  const page = images(theme.background);
  const panel = images(theme.panelBackground);
  const url = (path: string) => `url("${fileUrl(pluginId, path)}")`;
  /** The rules that put a scheme's images (or both schemes') on the page and in panels. */
  const imageRules = (pagePath: string | undefined, panelPath: string | undefined) => [
    ...(panelPath ? [rule(scope, [`--vtt-panel-image: ${url(panelPath)}`])] : []),
    ...(pagePath
      ? [rule(`${scope} [data-vtt-part="table"]`, [`background-image: ${url(pagePath)}`])]
      : []),
  ];
  if (always.length > 0) out.push(rule(scope, always));
  out.push(...imageRules(page.both, panel.both));
  const schemes = [
    ['not (prefers-color-scheme: dark)', theme.light, page.light, panel.light],
    ['(prefers-color-scheme: dark)', theme.dark, page.dark, panel.dark],
  ] as const;
  for (const [query, set, pagePath, panelPath] of schemes) {
    const colors = THEME_COLORS.flatMap((key) =>
      set?.[key] ? [`${cssVar(key)}: ${set[key]}`] : [],
    );
    const rules = [
      ...(colors.length > 0 ? [rule(scope, colors)] : []),
      ...imageRules(pagePath, panelPath),
    ];
    if (rules.length > 0) out.push(`@media ${query} {\n${rules.join('\n')}\n}`);
  }
  return `${out.join('\n')}\n`;
}
