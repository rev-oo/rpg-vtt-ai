import { PLUGIN_FILES, type PluginFileKind, pluginJsonSchema } from './json-schema.js';

// The plugin file reference (T-0704): the emitted JSON Schemas as Markdown, so the docs
// cannot drift from what the validator accepts. `pnpm build` writes it to
// `docs/plugin-reference.md`; a test fails when the committed file is stale.

type Json = Record<string, unknown>;

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
/** A bound worth printing; Zod's integer limits are left out. */
const asBound = (value: unknown): number | undefined =>
  typeof value === 'number' && Math.abs(value) < Number.MAX_SAFE_INTEGER ? value : undefined;
const code = (text: string): string => `\`${text}\``;
/** Keeps a table cell on one row. */
const cell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** `a`, `a or b`, `a, b or c`. */
const either = (words: readonly string[]): string =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`;

/** `1–500 characters`, `at least 1 item`, or undefined when there are no bounds. */
function bounds(low: number | undefined, high: number | undefined, unit = ''): string | undefined {
  const of = (count: number) => (unit === ' items' && count === 1 ? ' item' : unit);
  if (low !== undefined && high !== undefined) return `${String(low)}–${String(high)}${of(high)}`;
  if (low !== undefined) return `at least ${String(low)}${of(low)}`;
  if (high !== undefined) return `at most ${String(high)}${of(high)}`;
  return undefined;
}

/** The titled strings of `common.ts` and friends, in words; the patterns come from the schemas. */
const VALUE_TYPES: Readonly<Record<string, string>> = {
  Text: 'A lang key such as `field.str`, which the viewer sees translated, or literal text.',
  Formula:
    'A formula: see [Formulas](plugin-authoring.md#formulas). The validator parses it and checks its references, functions and dice.',
  Identifier:
    'Letters, digits and `_`, not starting with a digit, such as `strMod`. Formulas can refer to these names.',
  Name: 'Letters, digits, `_` and `-`, starting with a letter, such as `character`.',
  'Plugin id': 'Lowercase letters, digits and inner hyphens, such as `tiny-d20`.',
  Version: 'A semantic version, such as `1.0.0` or `2.1.0-beta.1`.',
  Locale: 'A language code, such as `en` or `pt-BR`.',
  Path: 'Identifiers joined by dots, such as `hp.value`.',
  'CSS classes': 'Class names separated by spaces.',
};

/** How each value type was found in the schemas: its pattern and length limits. */
type Seen = Map<string, Json>;

interface Section {
  anchor: string;
  title: string;
  schema: Json;
}

/** Renders one file kind; sections for nested objects are added as they are linked. */
class KindWriter {
  private readonly sections: Section[] = [];
  private readonly bySchema = new Map<Json, Section>();
  private readonly defs: Json;

  constructor(
    private readonly kind: PluginFileKind,
    private readonly root: Json,
    private readonly seen: Seen,
  ) {
    this.defs = isJson(root.$defs) ? root.$defs : {};
  }

  /** A link to the section describing `schema`, adding it the first time. */
  private link(schema: Json, title: string): string {
    let section = this.bySchema.get(schema);
    if (!section) {
      section = { anchor: `${this.kind}-${slug(title)}`, title, schema };
      this.bySchema.set(schema, section);
      this.sections.push(section);
    }
    return `[${section.title}](#${section.anchor})`;
  }

  private resolve(schema: Json): Json {
    const ref = asText(schema.$ref);
    const target = ref?.startsWith('#/$defs/')
      ? this.defs[ref.slice('#/$defs/'.length)]
      : undefined;
    return isJson(target) ? target : schema;
  }

  private isUnion(schema: Json): boolean {
    return schema.anyOf !== undefined || schema.oneOf !== undefined;
  }

  /** The options of a union, nested unions flattened. */
  private options(schema: Json): Json[] {
    return [...asList(schema.anyOf), ...asList(schema.oneOf)]
      .filter(isJson)
      .map((option) => this.resolve(option))
      .flatMap((option) => (this.isUnion(option) ? this.options(option) : [option]));
  }

  /** The variants of a union of objects, each with its title; undefined for other unions. */
  private variants(schema: Json, title: string): { schema: Json; title: string }[] | undefined {
    const options = this.options(schema);
    if (!options.every((option) => isJson(option.properties))) return undefined;
    return options.map((option, index) => {
      const properties = isJson(option.properties) ? option.properties : {};
      const tag = isJson(properties.type) ? properties.type.const : undefined;
      const name =
        asText(option.title) ??
        (typeof tag === 'string' ? `${title} ${code(tag)}` : `${title} ${String(index + 1)}`);
      return { schema: option, title: name };
    });
  }

  /** What a value may be, in words; `title` names any section it links to. */
  type(input: Json, title: string): string {
    const schema = this.resolve(input);
    const named = asText(schema.title);
    if (this.isUnion(schema)) {
      // A titled union, such as Node, gets a section listing its variants.
      if (named !== undefined) return this.link(schema, named);
      const variants = this.variants(schema, title);
      return variants
        ? `one of ${variants.map((variant) => this.link(variant.schema, variant.title)).join(', ')}`
        : either(this.options(schema).map((option) => this.type(option, title)));
    }
    if (schema.const !== undefined) return code(JSON.stringify(schema.const));
    if (Array.isArray(schema.enum)) {
      return `one of ${schema.enum.map((value) => code(JSON.stringify(value))).join(', ')}`;
    }
    const type = schema.type;
    if (Array.isArray(type)) return either(type.map((name) => this.scalar(String(name))));
    switch (type) {
      case 'string': {
        const pattern = asText(schema.pattern);
        if (named !== undefined && Object.hasOwn(VALUE_TYPES, named)) {
          if (!this.seen.has(named)) this.seen.set(named, schema);
          return `[${named.toLowerCase()}](#${slug(named)})`;
        }
        const parts = [
          bounds(asBound(schema.minLength), asBound(schema.maxLength), ' characters'),
          pattern === undefined ? undefined : `matching ${code(pattern)}`,
        ].filter((part) => part !== undefined);
        return parts.length > 0 ? `text (${parts.join(', ')})` : 'text';
      }
      case 'integer':
      case 'number': {
        const range = bounds(asBound(schema.minimum), asBound(schema.maximum));
        return [type, range].filter((part) => part !== undefined).join(', ');
      }
      case 'boolean':
        return this.scalar(type);
      case 'array': {
        const items = isJson(schema.items) ? this.type(schema.items, title) : 'any JSON value';
        const count = bounds(asBound(schema.minItems), asBound(schema.maxItems), ' items');
        return `list of ${items}${count === undefined ? '' : ` (${count})`}`;
      }
      case 'object':
        return this.object(schema, named ?? title);
      default:
        return 'any JSON value';
    }
  }

  private scalar(type: string): string {
    if (type === 'boolean') return 'true or false';
    return type === 'string' ? 'text' : type;
  }

  private object(schema: Json, title: string): string {
    const properties = isJson(schema.properties) ? Object.keys(schema.properties) : [];
    if (properties.some((key) => key !== '$schema')) return this.link(schema, title);
    const values = schema.additionalProperties;
    if (isJson(values)) {
      const keys = isJson(schema.propertyNames) ? this.type(schema.propertyNames, title) : 'text';
      return `map from ${keys} to ${this.type(values, title)}`;
    }
    return 'object';
  }

  /** A section's body: a table of keys and what other keys hold, or a union's variants. */
  body(schema: Json, title: string): string[] {
    const lines: string[] = [];
    const description = asText(schema.description);
    if (description !== undefined) lines.push(description, '');
    if (this.isUnion(schema)) {
      const variants = this.variants(schema, title) ?? [];
      lines.push('One of:', '');
      for (const variant of variants) {
        const about = asText(variant.schema.description);
        const link = this.link(variant.schema, variant.title);
        lines.push(`- ${link}${about === undefined ? '' : `: ${about}`}`);
      }
      lines.push('');
      return lines;
    }
    const properties = isJson(schema.properties) ? schema.properties : {};
    const required = new Set(asList(schema.required).map(String));
    const rows = Object.entries(properties).flatMap(([key, value]) => {
      if (!isJson(value)) return [];
      const about =
        key === '$schema'
          ? 'The URL or path of this JSON Schema, so editors check the file.'
          : (asText(value.description) ?? '');
      const type = this.type(value, code(key));
      return [
        `| ${code(key)} | ${cell(type)} | ${required.has(key) ? 'yes' : ''} | ${cell(about)} |`,
      ];
    });
    if (rows.length > 0) {
      lines.push('| Key | Value | Required | About |', '| --- | --- | --- | --- |', ...rows, '');
    }
    const values = schema.additionalProperties;
    if (isJson(values)) {
      const other = rows.length > 0 ? 'Any other key' : 'Every key';
      const keys = isJson(schema.propertyNames)
        ? ` is ${this.type(schema.propertyNames, title)} and`
        : '';
      lines.push(`${other}${keys} maps to ${this.type(values, title)}.`, '');
    }
    return lines;
  }

  render(): string[] {
    const { title } = PLUGIN_FILES[this.kind];
    const lines = [
      `<a id="${this.kind}"></a>`,
      '',
      `## ${title}`,
      '',
      ...this.body(this.root, title),
    ];
    // Sections are added while earlier ones render; the loop reaches them too.
    for (const section of this.sections) {
      const body = this.body(section.schema, section.title);
      lines.push(`<a id="${section.anchor}"></a>`, '', `### ${section.title}`, '', ...body);
    }
    return lines;
  }
}

/** The value types the files use, with the rule each schema enforces. */
function valueTypes(seen: Seen): string[] {
  const rows = Object.entries(VALUE_TYPES)
    .filter(([title]) => seen.has(title))
    .map(([title, about]) => {
      const schema = seen.get(title) ?? {};
      const pattern = asText(schema.pattern);
      const rule = [
        bounds(asBound(schema.minLength), asBound(schema.maxLength), ' characters'),
        pattern === undefined ? undefined : code(pattern),
      ]
        .filter((part) => part !== undefined)
        .join(', ');
      return `| <a id="${slug(title)}"></a>${title} | ${cell(about)} | ${cell(rule)} |`;
    });
  return [
    '## Value types',
    '',
    'The tables below name these kinds of text:',
    '',
    '| Type | Means | Rule |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ];
}

/** The plugin file reference as Markdown (`docs/plugin-reference.md`). */
export function pluginReference(): string {
  const kinds = Object.keys(PLUGIN_FILES) as PluginFileKind[];
  const seen: Seen = new Map();
  const files = kinds.flatMap((kind) =>
    new KindWriter(kind, pluginJsonSchema(kind), seen).render(),
  );
  const lines = [
    '<!-- Generated from packages/plugin-schema by `pnpm build`. Do not edit. -->',
    '',
    '# Plugin file reference',
    '',
    'Every file a plugin may contain, with each key it accepts. This page is generated from the schemas the validator uses; the [authoring guide](plugin-authoring.md) explains how the files fit together. Beyond these shapes, the validator checks formulas, lang keys and the links between files.',
    '',
    ...kinds.map((kind) => `- [${PLUGIN_FILES[kind].title}](#${kind})`),
    '',
    ...valueTypes(seen),
    ...files,
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
