<!-- Generated from packages/plugin-schema by `pnpm build`. Do not edit. -->

# Plugin file reference

Every file a plugin may contain, with each key it accepts. This page is generated from the schemas the validator uses; the [authoring guide](plugin-authoring.md) explains how the files fit together. Beyond these shapes, the validator checks formulas, lang keys and the links between files.

- [Plugin manifest (plugin.json)](#plugin)
- [Actor type (types/actors/<type>.json)](#actor-type)
- [Item type (types/items/<type>.json)](#item-type)
- [Sheet layout (sheets/<name>.json)](#sheet)
- [Roll recipes (rolls.json)](#rolls)
- [Custom dice (dice.json)](#dice)
- [Chat card (cards/<name>.json)](#card)
- [Plugin settings (settings.json)](#settings)
- [Combat (combat.json)](#combat)
- [Compendium pack (packs/<name>.json)](#pack)
- [Data migration (migrations/<version>.json)](#migration)
- [Translations (lang/<locale>.json)](#lang)
- [Module theme (theme.json)](#theme)

## Value types

The tables below name these kinds of text:

| Type | Means | Rule |
| --- | --- | --- |
| <a id="text"></a>Text | A lang key such as `field.str`, which the viewer sees translated, or literal text. | 1–500 characters |
| <a id="formula"></a>Formula | A formula: see [Formulas](plugin-authoring.md#formulas). The validator parses it and checks its references, functions and dice. | 1–2000 characters |
| <a id="identifier"></a>Identifier | Letters, digits and `_`, not starting with a digit, such as `strMod`. Formulas can refer to these names. | `^[A-Za-z_][A-Za-z0-9_]*$` |
| <a id="name"></a>Name | Letters, digits, `_` and `-`, starting with a letter, such as `character`. | `^[A-Za-z][A-Za-z0-9_-]{0,63}$` |
| <a id="plugin-id"></a>Plugin id | Lowercase letters, digits and inner hyphens, such as `tiny-d20`. | `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` |
| <a id="version"></a>Version | A semantic version, such as `1.0.0` or `2.1.0-beta.1`. | `^(?:0\|[1-9]\d*)\.(?:0\|[1-9]\d*)\.(?:0\|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$` |
| <a id="locale"></a>Locale | A language code, such as `en` or `pt-BR`. | `^[a-z]{2,3}(?:-[A-Z]{2})?$` |
| <a id="path"></a>Path | Identifiers joined by dots, such as `hp.value`. | `^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$` |
| <a id="css-classes"></a>CSS classes | Class names separated by spaces. | at most 200 characters |
| <a id="colour"></a>Colour | A CSS colour: a hex code such as `#7a3b12`, a name such as `transparent`, or a colour function of numbers such as `rgb(120 60 20 / 0.5)`. | `^(?:#[0-9a-fA-F]{3,8}\|[a-zA-Z]{3,30}\|(?:rgba?\|hsla?\|hwb\|lab\|lch\|oklab\|oklch)\([0-9a-z.%\s,/+-]{1,80}\))$` |
| <a id="length"></a>Length | A CSS length in `px`, `rem` or `em`, such as `2px` or `0.25rem`, or `0`. | `^(?:0\|\d{1,3}(?:\.\d{1,3})?(?:px\|rem\|em))$` |
| <a id="font-list"></a>Font list | CSS font names separated by commas, quoted when they have spaces. | `^[A-Za-z0-9 ,'"_-]{1,200}$` |
| <a id="font-name"></a>Font name | A font family name: letters, digits, spaces, `_` and `-`. | `^[A-Za-z0-9 _-]{1,60}$` |
| <a id="module-file"></a>Module file | A file of the module, relative to its folder, such as `images/paper.webp`; it may not leave the folder. | `^(?!.*(?:^\|\/)\.\.?(?:\/\|$))[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$` |

<a id="plugin"></a>

## Plugin manifest (plugin.json)

The plugin manifest. Every plugin has one, at the root of its folder.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `id` | [plugin id](#plugin-id) | yes | Unique on the instance, and the name of the plugin folder. Do not change it once tables use the plugin. |
| `name` | text (1–100 characters) | yes | The name admins and GMs see. |
| `version` | [version](#version) | yes | The plugin version, such as `1.0.0`. |
| `kind` | one of `"system"`, `"module"` | yes | `system` for a game system, which a table is created with; `module` for an add-on that GMs add to any table, whatever its system (themes, overlays, panels). |
| `coreApi` | text (1–100 characters) | yes | The core API versions the plugin works with, as a semver range such as `^0.1.0`. A server outside the range lists the plugin as unusable. |
| `description` | text (at most 2000 characters) |  | Shown on the plugin admin page. |
| `author` | text (at most 200 characters) |  |  |
| `license` | text (at most 100 characters) |  |  |
| `hasCode` | true or false | yes | True exactly when the plugin has a `code/` folder. Admins must acknowledge code before enabling the plugin. |
| `locales` | list of [locale](#locale) (at least 1 item) |  | The languages in `lang/`. Each needs its `lang/<locale>.json`. |
| `defaultLocale` | [locale](#locale) |  | The language whose text shows when the viewer's language lacks a key; one of `locales`. Defaults to the first of `locales`, then `en`. |
| `frames` | [Module frames](#plugin-module-frames) |  | A module's overlays and panels. Each must be exported by `code/client` under the same name; only modules with code have them. |

<a id="plugin-module-frames"></a>

### Module frames

A module's overlays and panels. Each must be exported by `code/client` under the same name; only modules with code have them.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `overlays` | map from text (matching `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`) to [`overlays`](#plugin-overlays) |  | Overlays over the table page, by the name `code/client` exports them under. |
| `panels` | map from text (matching `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`) to [`panels`](#plugin-panels) |  | Panels in the table workspace, by the name `code/client` exports them under. |

<a id="plugin-overlays"></a>

### `overlays`

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `interactive` | true or false |  | True when the overlay takes the pointer; otherwise clicks pass through it. |

<a id="plugin-panels"></a>

### `panels`

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `title` | [text](#text) | yes | The panel's title: a lang key or literal text. |

<a id="actor-type"></a>

## Actor type (types/actors/<type>.json)

An actor type, such as a character or an NPC.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `label` | [text](#text) | yes | The type name players see; a lang key or literal text. |
| `sheet` | [name](#name) | yes | The sheet in `sheets/`, without `.json`. |
| `schema` | [Data schema](#actor-type-data-schema) | yes | The entity's data: an object whose properties are fields. |
| `derived` | map from [identifier](#identifier) to [formula](#formula) |  | Values computed from the data and never stored, by name. Formulas read them as `@derived.<name>`. |
| `controlledBy` | one of `"player"`, `"gm"` | yes | Who may create actors of the type: players too, or only the GM. |

<a id="actor-type-data-schema"></a>

### Data schema

The entity's data: an object whose properties are fields.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | `"object"` | yes |  |
| `properties` | map from [identifier](#identifier) to [Field](#actor-type-field) | yes |  |
| `required` | list of [identifier](#identifier) |  |  |
| `description` | text (at most 2000 characters) |  |  |

<a id="actor-type-field"></a>

### Field

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | one of `"string"`, `"integer"`, `"number"`, `"boolean"`, `"object"`, `"array"` | yes |  |
| `description` | text (at most 2000 characters) |  |  |
| `default` | any JSON value |  | The value new entities start with; it must fit the field. |
| `enum` | list of text or number (at least 1 item) |  | The allowed values; a `select` input offers them. |
| `minimum` | number or [formula](#formula) |  | The lowest value allowed. On a counter (`x-counter`) it may be a formula, such as `@hp.max`, worked out against the entity on every step. |
| `maximum` | number or [formula](#formula) |  | The highest value allowed. On a counter (`x-counter`) it may be a formula, such as `@hp.max`, worked out against the entity on every step. |
| `minLength` | integer, at least 0 |  |  |
| `maxLength` | integer, at least 0 |  |  |
| `format` | `"dice"` |  | For a `string`: the text must be a dice expression, such as `2d6 + 3` (numbers, dice and + - * / only), or blank. Formulas roll it with `roll(@field)`. |
| `required` | list of [identifier](#identifier) |  |  |
| `properties` | map from [identifier](#identifier) to [Field](#actor-type-field) |  | The fields of an `object`, by name. |
| `items` | [Field](#actor-type-field) |  | The rows of an `array`; an `object` for a collection. |
| `x-kind` | one of `"longText"`, `"collection"`, `"richText"`, `"image"` |  | How the core stores and edits the field: `longText` and `richText` are shared text that several people edit at once, `collection` is a list of rows with ids, `image` is a picture URL. |
| `x-counter` | true or false |  | A number changed in steps; steps from several people at once add up instead of overwriting each other. |
| `x-layer` | `"secret"` |  | Only the GM and assistants see the field; it never reaches players. |

<a id="item-type"></a>

## Item type (types/items/<type>.json)

An item type, such as a weapon or a spell.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `label` | [text](#text) | yes | The type name players see; a lang key or literal text. |
| `sheet` | [name](#name) | yes | The sheet in `sheets/`, without `.json`. |
| `schema` | [Data schema](#item-type-data-schema) | yes | The entity's data: an object whose properties are fields. |
| `derived` | map from [identifier](#identifier) to [formula](#formula) |  | Values computed from the data and never stored, by name. Formulas read them as `@derived.<name>`. |
| `labelPlural` | [text](#text) |  | The type name for a list of them, such as "Weapons"; a lang key or literal text. It heads the type’s items when the type has no `group`. |
| `group` | [text](#text) |  | The heading item lists show this type under, such as "Spells" or "Gear"; a lang key or literal text. Types with the same group share it. |
| `order` | integer, -1000–1000 |  | Where its group comes in item lists: lowest first, then by heading. A group takes the lowest `order` of its types. Default 0. |
| `contributes` | map from [identifier](#identifier) to [Contribution](#item-type-contribution) |  | Values the type adds to whoever holds it, by name. Actor formulas read the total over their items as `@items.<name>`. Types that contribute the same name must combine it the same way. |

<a id="item-type-data-schema"></a>

### Data schema

The entity's data: an object whose properties are fields.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | `"object"` | yes |  |
| `properties` | map from [identifier](#identifier) to [Field](#item-type-field) | yes |  |
| `required` | list of [identifier](#identifier) |  |  |
| `description` | text (at most 2000 characters) |  |  |

<a id="item-type-contribution"></a>

### Contribution

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `formula` | [formula](#formula) | yes | Worked out for each item from its own data and derived values; it cannot read secret fields. |
| `combine` | one of `"sum"`, `"max"`, `"min"`, `"any"`, `"count"` |  | How the items’ values combine: `sum` (the default), `max` or `min` of numbers; `any` (true if one is) or `count` (how many are) of true/false. |
| `default` | number |  | The value of a `max` or `min` when no item contributes; required for those two. |

<a id="item-type-field"></a>

### Field

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | one of `"string"`, `"integer"`, `"number"`, `"boolean"`, `"object"`, `"array"` | yes |  |
| `description` | text (at most 2000 characters) |  |  |
| `default` | any JSON value |  | The value new entities start with; it must fit the field. |
| `enum` | list of text or number (at least 1 item) |  | The allowed values; a `select` input offers them. |
| `minimum` | number or [formula](#formula) |  | The lowest value allowed. On a counter (`x-counter`) it may be a formula, such as `@hp.max`, worked out against the entity on every step. |
| `maximum` | number or [formula](#formula) |  | The highest value allowed. On a counter (`x-counter`) it may be a formula, such as `@hp.max`, worked out against the entity on every step. |
| `minLength` | integer, at least 0 |  |  |
| `maxLength` | integer, at least 0 |  |  |
| `format` | `"dice"` |  | For a `string`: the text must be a dice expression, such as `2d6 + 3` (numbers, dice and + - * / only), or blank. Formulas roll it with `roll(@field)`. |
| `required` | list of [identifier](#identifier) |  |  |
| `properties` | map from [identifier](#identifier) to [Field](#item-type-field) |  | The fields of an `object`, by name. |
| `items` | [Field](#item-type-field) |  | The rows of an `array`; an `object` for a collection. |
| `x-kind` | one of `"longText"`, `"collection"`, `"richText"`, `"image"` |  | How the core stores and edits the field: `longText` and `richText` are shared text that several people edit at once, `collection` is a list of rows with ids, `image` is a picture URL. |
| `x-counter` | true or false |  | A number changed in steps; steps from several people at once add up instead of overwriting each other. |
| `x-layer` | `"secret"` |  | Only the GM and assistants see the field; it never reaches players. |

<a id="sheet"></a>

## Sheet layout (sheets/<name>.json)

A sheet layout: a tree of nodes. Types name their sheet in `sheet`.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `layout` | [Node](#sheet-node) | yes |  |

<a id="sheet-node"></a>

### Node

One of:

- [Node `row`](#sheet-node-row): Lays its children out side by side.
- [Node `column`](#sheet-node-column): Stacks its children.
- [Node `grid`](#sheet-node-grid): Lays its children out in columns.
- [Node `tabs`](#sheet-node-tabs): Shows one tab at a time.
- [Node `section`](#sheet-node-section): A titled group.
- [Node `field`](#sheet-node-field): Edits one field, and shows who else is in it.
- [Node `longText`](#sheet-node-longtext): A text box several people can type into at once; rich text gets a toolbar.
- [Node `list`](#sheet-node-list): The rows of an array, with add, remove and reorder. `item` is one row's layout; its paths are relative to the row.
- [Node `items`](#sheet-node-items): The actor's items, grouped, each edited in place, with open, remove and add (actor sheets only). `item` is one item's layout: its paths are relative to the item's data, and `@item.id`, `@item.name` and `@item.type` name the item.
- [Node `rollButton`](#sheet-node-rollbutton): Rolls a recipe for the entity and posts it to chat.
- [Node `derived`](#sheet-node-derived): Shows a derived value.
- [Node `image`](#sheet-node-image): Shows the picture of an image field. Those who may edit the sheet click it to pick another, or to remove it.
- [Node `text`](#sheet-node-text): Static text.
- [Node `custom:<name>`](#sheet-node-custom-name): A component from the plugin's `code/client`, by its name in `nodes`.

<a id="sheet-node-row"></a>

### Node `row`

Lays its children out side by side.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"row"` | yes |  |
| `children` | list of [Node](#sheet-node) | yes | The nodes inside, in order. |
| `gap` | one of `"none"`, `"sm"`, `"md"`, `"lg"` |  | The space between children. |
| `wrap` | true or false |  | Wraps children onto more lines when narrow. |

<a id="sheet-node-column"></a>

### Node `column`

Stacks its children.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"column"` | yes |  |
| `children` | list of [Node](#sheet-node) | yes | The nodes inside, in order. |
| `gap` | one of `"none"`, `"sm"`, `"md"`, `"lg"` |  | The space between children. |

<a id="sheet-node-grid"></a>

### Node `grid`

Lays its children out in columns.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"grid"` | yes |  |
| `children` | list of [Node](#sheet-node) | yes | The nodes inside, in order. |
| `columns` | integer, 1–12 | yes | Columns on wide screens; phones show one. |

<a id="sheet-node-tabs"></a>

### Node `tabs`

Shows one tab at a time.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"tabs"` | yes |  |
| `tabs` | list of [Tab](#sheet-tab) (at least 1 item) | yes |  |

<a id="sheet-node-section"></a>

### Node `section`

A titled group.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"section"` | yes |  |
| `title` | [text](#text) | yes | The heading; a lang key or literal text. |
| `children` | list of [Node](#sheet-node) | yes | The nodes inside, in order. |
| `collapsible` | true or false |  | Lets the viewer fold it away. |

<a id="sheet-node-field"></a>

### Node `field`

Edits one field, and shows who else is in it.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"field"` | yes |  |
| `path` | [path](#path) | yes | The field, as a dot path such as `hp.value`. |
| `label` | [text](#text) |  | A lang key or literal text; defaults to the field's path. |
| `input` | one of `"text"`, `"number"`, `"checkbox"`, `"select"`, `"counter"` |  | The control: `text` (the default), `number`, `checkbox` (boolean fields), `select` (fields with `enum`) or `counter` (− and + buttons). |

<a id="sheet-node-longtext"></a>

### Node `longText`

A text box several people can type into at once; rich text gets a toolbar.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"longText"` | yes |  |
| `path` | [path](#path) | yes | A `longText` or `richText` field. |
| `label` | [text](#text) |  | A lang key or literal text; defaults to the field's path. |

<a id="sheet-node-list"></a>

### Node `list`

The rows of an array, with add, remove and reorder. `item` is one row's layout; its paths are relative to the row.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"list"` | yes |  |
| `path` | [path](#path) | yes | An `array` field. |
| `item` | [Node](#sheet-node) | yes |  |
| `addLabel` | [text](#text) |  | The text of the add button. |

<a id="sheet-node-items"></a>

### Node `items`

The actor's items, grouped, each edited in place, with open, remove and add (actor sheets only). `item` is one item's layout: its paths are relative to the item's data, and `@item.id`, `@item.name` and `@item.type` name the item.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"items"` | yes |  |
| `itemTypes` | list of [name](#name) (at least 1 item) |  | The item types to list; every type when left out. |
| `item` | [Node](#sheet-node) | yes |  |
| `addLabel` | [text](#text) |  | The text of the add button. |

<a id="sheet-node-rollbutton"></a>

### Node `rollButton`

Rolls a recipe for the entity and posts it to chat.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"rollButton"` | yes |  |
| `roll` | [name](#name) | yes | A recipe in `rolls.json`. |
| `label` | [text](#text) | yes | The button's text. |
| `args` | map from [identifier](#identifier) to [formula](#formula), number or true or false |  | Values the recipe reads as `@args.<name>`: formulas, numbers or true/false. In a list, `"@row.id"` names the row. |

<a id="sheet-node-derived"></a>

### Node `derived`

Shows a derived value.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"derived"` | yes |  |
| `key` | [identifier](#identifier) | yes | A name in the type's `derived`. |
| `label` | [text](#text) |  | A lang key or literal text; defaults to the key. |
| `format` | one of `"integer"`, `"signed"`, `"decimal"` |  | `integer` rounds, `signed` rounds and shows `+2` or `−1`, `decimal` keeps two places. |

<a id="sheet-node-image"></a>

### Node `image`

Shows the picture of an image field. Those who may edit the sheet click it to pick another, or to remove it.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"image"` | yes |  |
| `path` | [path](#path) | yes | A string field holding the picture URL. |
| `size` | one of `"sm"`, `"md"`, `"lg"` |  | Defaults to `md`. |

<a id="sheet-node-text"></a>

### Node `text`

Static text.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | `"text"` | yes |  |
| `text` | [text](#text) | yes | A lang key or literal text. |

<a id="sheet-node-custom-name"></a>

### Node `custom:<name>`

A component from the plugin's `code/client`, by its name in `nodes`.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `class` | [css classes](#css-classes) |  | Extra CSS classes, for `styles/*.css`. |
| `visibleIf` | [formula](#formula) |  | Shows the node only while this formula is true. It cannot roll dice. |
| `type` | text (matching `^custom:[A-Za-z][A-Za-z0-9_-]{0,63}$`) | yes |  |
| `props` | map from text to any JSON value |  | Any JSON, passed to the component as `props`. |

<a id="sheet-tab"></a>

### Tab

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | The tab title. |
| `children` | list of [Node](#sheet-node) | yes | The nodes inside, in order. |

<a id="rolls"></a>

## Roll recipes (rolls.json)

Roll recipes for `rollButton` nodes, each under a name such as `skill` (letters, digits, `_` and `-`).

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |

Any other key maps to one of [Formula recipe](#rolls-formula-recipe), [Handler recipe](#rolls-handler-recipe).

<a id="rolls-formula-recipe"></a>

### Formula recipe

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) |  | The roll name in chat; a lang key or literal text. |
| `let` | map from [identifier](#identifier) to [formula](#formula) |  | Named values worked out before rolling, in order, without dice. The formulas, outcomes and card read them as `@let.<name>`; each reads the ones before it. |
| `options` | map from [identifier](#identifier) to one of [Choice option](#rolls-choice-option), [Number option](#rolls-number-option), [Dice option](#rolls-dice-option) |  | What the app asks for when the button is pressed: a choice, a whole number or dice. Formulas, named values, outcomes and the card read them as `@options.<name>`; the server checks them. |
| `formula` | [formula](#formula) or map from [identifier](#identifier) to [formula](#formula) | yes | What to roll: dice and `@` references to the entity's data, `@derived`, `@args` and `@settings`. Or several formulas by name, rolled in order into one message; each reads those before it as `@rolls.<name>`. |
| `outcomes` | list of [Outcome](#rolls-outcome) |  | Checked in order; the first whose `when` is true is shown. |
| `card` | [name](#name) |  | A card in `cards/`, without `.json`, to show the roll with. |
| `item` | list of [name](#name) (at least 1 item) |  | Item types the roll is made with. It is then rolled from an `items` row or an item’s sheet; formulas read the item as `@item`, and server code gets it as `item`. |
| `then` | [name](#name) |  | A handler in `code/server`, run after the roll is posted. It gets the result, the item and the options, and can step counters, such as spending a spell slot. |
| `actors` | list of [name](#name) (at least 1 item) |  | The actor types that may roll it. The validator checks it against these only, sheets of other types cannot show its buttons, and the server refuses it for other actors. |

<a id="rolls-handler-recipe"></a>

### Handler recipe

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) |  |  |
| `handler` | [name](#name) | yes | A handler in `code/server`, run on the server when the recipe is rolled. |
| `item` | list of [name](#name) (at least 1 item) |  | Item types the roll is made with. It is then rolled from an `items` row or an item’s sheet; formulas read the item as `@item`, and server code gets it as `item`. |
| `actors` | list of [name](#name) (at least 1 item) |  | The actor types that may roll it. The validator checks it against these only, sheets of other types cannot show its buttons, and the server refuses it for other actors. |

<a id="rolls-choice-option"></a>

### Choice option

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | `"choice"` | yes |  |
| `label` | [text](#text) | yes | What the option asks; a lang key or literal text. |
| `choices` | list of [`choices`](#rolls-choices) (2–10 items) | yes |  |
| `default` | [identifier](#identifier) |  | The value picked at first; the first when left out. |

<a id="rolls-number-option"></a>

### Number option

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | `"number"` | yes |  |
| `label` | [text](#text) | yes | What the option asks; a lang key or literal text. |
| `default` | number or [formula](#formula) | yes | A whole number, or a formula such as `@item.level`. |
| `minimum` | number or [formula](#formula) |  | The lowest whole number allowed, or a formula. |
| `maximum` | number or [formula](#formula) |  | The highest whole number allowed, or a formula. |

<a id="rolls-dice-option"></a>

### Dice option

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | `"dice"` | yes |  |
| `label` | [text](#text) | yes | What the option asks; a lang key or literal text. |
| `default` | text (at most 200 characters) |  | Dice such as `1d4`, or nothing (the default). |

<a id="rolls-outcome"></a>

### Outcome

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `when` | [formula](#formula) |  | A true/false formula that can read `@total`, `@roll`, `@rolls`, `@let` and `@options`; leave it out for the fallback. |
| `label` | [text](#text) | yes | Shown with the roll; a lang key or literal text. |
| `class` | [css classes](#css-classes) |  | A CSS class for the outcome, for `styles/*.css`. |

<a id="rolls-choices"></a>

### `choices`

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `value` | [identifier](#identifier) | yes | Read as `@options.<name>`, such as `'advantage'`. |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `key` | one of `"shift"`, `"ctrl"` |  | Holding this key while clicking the button picks this choice and rolls at once, with the other options at their defaults. |

<a id="dice"></a>

## Custom dice (dice.json)

Custom dice by name: `d` and capitals or digits, such as `dF`.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |

Any other key maps to [Die](#dice-die).

<a id="dice-die"></a>

### Die

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) |  | The die name; a lang key or literal text. |
| `faces` | list of text (at most 20 characters), number or [Face](#dice-face) (1–1000 items) | yes | Equally likely faces: a label, a number, or `{ label, value }`. |
| `values` | map from text (at most 20 characters) to number |  | What text faces count as, such as `{ "-": -1, " ": 0, "+": 1 }` for Fate. |

<a id="dice-face"></a>

### Face

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | text (at most 20 characters) | yes |  |
| `value` | number | yes |  |

<a id="card"></a>

## Chat card (cards/<name>.json)

How a recipe roll shows in chat.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `title` | [text](#text) | yes | A lang key or literal text. |
| `rows` | list of [Card row](#card-card-row) | yes |  |
| `outcome` | true or false |  | Shows the recipe's outcome. |

<a id="card-card-row"></a>

### Card row

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `value` | [formula](#formula) | yes | Reads `@total`, `@roll` (`expression`, `resolved`, `total`, `natural`, `dice`), the recipe's `@rolls` and `@let`, and the entity's data. It cannot roll dice. |
| `class` | [css classes](#css-classes) |  |  |

<a id="settings"></a>

## Plugin settings (settings.json)

Options under identifiers such as `startingHp`, set per table (the default), per instance or per user. Formulas read table options as `@settings.<name>`.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |

Any other key maps to [Setting](#settings-setting).

<a id="settings-setting"></a>

### Setting

One of:

- [Setting `boolean`](#settings-setting-boolean): A checkbox.
- [Setting `integer`](#settings-setting-integer): A whole number.
- [Setting `number`](#settings-setting-number): A number.
- [Setting `string`](#settings-setting-string): Text, or a choice with `enum`.

<a id="settings-setting-boolean"></a>

### Setting `boolean`

A checkbox.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `description` | [text](#text) |  | Help shown under the option. |
| `scope` | one of `"instance"`, `"table"`, `"user"` |  | Who sets the option: `table` (the default), the GM in table settings; `instance`, admins on the Plugins page, for every table; `user`, each member for themselves. Formulas read only `table` options. |
| `type` | `"boolean"` | yes |  |
| `default` | true or false | yes |  |

<a id="settings-setting-integer"></a>

### Setting `integer`

A whole number.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `description` | [text](#text) |  | Help shown under the option. |
| `scope` | one of `"instance"`, `"table"`, `"user"` |  | Who sets the option: `table` (the default), the GM in table settings; `instance`, admins on the Plugins page, for every table; `user`, each member for themselves. Formulas read only `table` options. |
| `type` | `"integer"` | yes |  |
| `default` | integer | yes |  |
| `minimum` | integer |  |  |
| `maximum` | integer |  |  |

<a id="settings-setting-number"></a>

### Setting `number`

A number.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `description` | [text](#text) |  | Help shown under the option. |
| `scope` | one of `"instance"`, `"table"`, `"user"` |  | Who sets the option: `table` (the default), the GM in table settings; `instance`, admins on the Plugins page, for every table; `user`, each member for themselves. Formulas read only `table` options. |
| `type` | `"number"` | yes |  |
| `default` | number | yes |  |
| `minimum` | number |  |  |
| `maximum` | number |  |  |

<a id="settings-setting-string"></a>

### Setting `string`

Text, or a choice with `enum`.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `description` | [text](#text) |  | Help shown under the option. |
| `scope` | one of `"instance"`, `"table"`, `"user"` |  | Who sets the option: `table` (the default), the GM in table settings; `instance`, admins on the Plugins page, for every table; `user`, each member for themselves. Formulas read only `table` options. |
| `type` | `"string"` | yes |  |
| `default` | text | yes |  |
| `enum` | list of text (at least 1 item) |  | Offers these values to pick from. |
| `maxLength` | integer, at least 1 |  |  |

<a id="combat"></a>

## Combat (combat.json)

Initiative for the combat tracker.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `initiative` | [formula](#formula) |  | What each combatant rolls for initiative, against its actor’s data. Free-form combatants roll without data. |
| `order` | one of `"desc"`, `"asc"`, `"sideBased"` |  | Turn order: highest first (`desc`, the default), lowest first (`asc`), or `sideBased`: the side with the best roll acts first, then the other, each highest first. A side is the actor type’s `controlledBy`; free-form combatants are on the GM’s side. An `orderCombatants` hook replaces the rule. |

<a id="pack"></a>

## Compendium pack (packs/<name>.json)

A compendium pack: actors and items members browse and copy into a table.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `label` | [text](#text) | yes | The pack’s name in the compendium; a lang key or text. |
| `entries` | list of [`entries`](#pack-entries) (at most 1000 items) | yes |  |

<a id="pack-entries"></a>

### `entries`

A compendium entry.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `id` | [name](#name) | yes | Stable within the pack and across versions: copies remember it, so the compendium marks entries a table already has. |
| `kind` | one of `"actor"`, `"item"` | yes | An actor or an item. |
| `type` | [name](#name) | yes | An actor or item type of this plugin. |
| `name` | text (1–100 characters) | yes | The name it gets in the table. |
| `data` | map from text to any JSON value |  | Its data, checked against the type’s schema; what it leaves out takes the defaults. Collections are lists of rows, as in defaults. |

<a id="migration"></a>

## Data migration (migrations/<version>.json)

A data migration: steps that bring actors and items made with an older version up to the version the file is named after.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `steps` | list of one of [Rename step](#migration-rename-step), [Move step](#migration-move-step), [Set default step](#migration-set-default-step), [Drop step](#migration-drop-step) (at most 200 items) | yes | Run in order, on each actor and item of the types they name. |

<a id="migration-rename-step"></a>

### Rename step

Renames a field in place.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `op` | `"rename"` | yes |  |
| `kind` | one of `"actor"`, `"item"` | yes | Whether the step changes actors or items. |
| `type` | [name](#name) | yes | The actor or item type whose data the step changes. |
| `path` | text (matching `^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.\*)*\.[A-Za-z_][A-Za-z0-9_]*)*$`) | yes | Field names joined by dots, such as `stats.hp`. `*` stands for every row of a collection: `inventory.*.weight`. |
| `to` | text (matching `^[A-Za-z_][A-Za-z0-9_]*$`) | yes | The field’s new name; it stays where it is: `stats.hp` to `health` gives `stats.health`. |

<a id="migration-move-step"></a>

### Move step

Moves a field’s value to another path.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `op` | `"move"` | yes |  |
| `kind` | one of `"actor"`, `"item"` | yes | Whether the step changes actors or items. |
| `type` | [name](#name) | yes | The actor or item type whose data the step changes. |
| `path` | text (matching `^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.\*)*\.[A-Za-z_][A-Za-z0-9_]*)*$`) | yes | Field names joined by dots, such as `stats.hp`. `*` stands for every row of a collection: `inventory.*.weight`. |
| `to` | text (matching `^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.\*)*\.[A-Za-z_][A-Za-z0-9_]*)*$`) | yes | Where the value goes. Objects on the way are created. A `*` row stays the same row: `inventory.*.wt` can move to `inventory.*.weight`, not out of the row. |

<a id="migration-set-default-step"></a>

### Set default step

Gives a field a value where the entity has none, such as an existing entity’s value for a new field whose default is meant for new ones.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `op` | `"setDefault"` | yes |  |
| `kind` | one of `"actor"`, `"item"` | yes | Whether the step changes actors or items. |
| `type` | [name](#name) | yes | The actor or item type whose data the step changes. |
| `path` | text (matching `^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.\*)*\.[A-Za-z_][A-Za-z0-9_]*)*$`) | yes | Field names joined by dots, such as `stats.hp`. `*` stands for every row of a collection: `inventory.*.weight`. |
| `value` | any JSON value | yes | The value it gets; it must fit the field. |

<a id="migration-drop-step"></a>

### Drop step

Removes a field and its value.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `op` | `"drop"` | yes |  |
| `kind` | one of `"actor"`, `"item"` | yes | Whether the step changes actors or items. |
| `type` | [name](#name) | yes | The actor or item type whose data the step changes. |
| `path` | text (matching `^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.\*)*\.[A-Za-z_][A-Za-z0-9_]*)*$`) | yes | Field names joined by dots, such as `stats.hp`. `*` stands for every row of a collection: `inventory.*.weight`. |

<a id="lang"></a>

## Translations (lang/<locale>.json)

Texts by lang key, such as `"field.str": "Strength"`. The file name is the locale.

Every key is text (1–200 characters) and maps to text.

<a id="theme"></a>

## Module theme (theme.json)

A module’s theme: the app’s design tokens on the table page while the module is on.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `light` | [Colours](#theme-colours) |  | Colours in the light scheme. |
| `dark` | [Colours](#theme-colours) |  | Colours in the dark scheme. |
| `font` | [font list](#font-list) |  | The text font, as a CSS font list such as `"IM Fell English", Georgia, serif`. |
| `radius` | [length](#length) |  | The corner radius of cards, panels and inputs, such as `0` or `0.25rem`; smaller and larger corners scale with it. |
| `border` | [length](#length) |  | The width of the borders of cards, panels and inputs, such as `2px`; `0` for none. |
| `density` | number, 0.75–1.5 |  | How far apart things are: paddings and gaps, as a multiple of the app’s (0.75–1.5). Below 1 is more compact, above 1 roomier. |
| `fonts` | list of [Font face](#theme-font-face) (at most 16 items) |  | Fonts loaded from the module’s files. |
| `background` | [module file](#module-file) or [Image per scheme](#theme-image-per-scheme) |  | An image of the module tiled behind the table page, such as `images/wood.webp`, or one per scheme (`{ "light": …, "dark": … }`). Docked panels cover it unless the theme’s `panel` colour lets it through, such as `transparent`. |
| `panelBackground` | [module file](#module-file) or [Image per scheme](#theme-image-per-scheme) |  | An image of the module tiled inside panels, over the `panel` colour, such as `images/paper.webp`, or one per scheme. |

<a id="theme-colours"></a>

### Colours

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `canvas` | [colour](#colour) |  | The page. |
| `surface` | [colour](#colour) |  | Cards, inputs, menus and tab bars. |
| `fg` | [colour](#colour) |  | Text. |
| `muted` | [colour](#colour) |  | Secondary text, such as hints and times. |
| `line` | [colour](#colour) |  | Borders and dividers. |
| `primary` | [colour](#colour) |  | Buttons, links, focus rings and accents. |
| `primaryHover` | [colour](#colour) |  | Buttons under the pointer. |
| `onPrimary` | [colour](#colour) |  | Text on `primary`. |
| `danger` | [colour](#colour) |  | Errors and destructive buttons. |
| `dangerSoft` | [colour](#colour) |  | The background of error notices. |
| `infoSoft` | [colour](#colour) |  | The background of notices and selected items. |
| `panel` | [colour](#colour) |  | Docked panels; `canvas` by default. `transparent` shows the page’s `background`. |

<a id="theme-font-face"></a>

### Font face

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `family` | [font name](#font-name) | yes | The name `font` and stylesheets use. |
| `src` | [module file](#module-file) | yes | A `.woff2`, `.woff`, `.ttf` or `.otf` file of the module. |
| `weight` | text (matching `^(?:normal\|bold\|[1-9]00(?: [1-9]00)?)$`) |  | The weight this file draws, such as `400` or `bold`, or a range such as `100 900` for a variable font. Defaults to `normal`. |
| `style` | one of `"normal"`, `"italic"` |  | Whether this file draws the italic. Defaults to `normal`. |

<a id="theme-image-per-scheme"></a>

### Image per scheme

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `light` | [module file](#module-file) |  | The image in the light scheme. |
| `dark` | [module file](#module-file) |  | The image in the dark scheme. |
