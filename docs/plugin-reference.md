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
- [Table settings (settings.json)](#settings)
- [Combat (combat.json)](#combat)
- [Translations (lang/<locale>.json)](#lang)

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

<a id="plugin"></a>

## Plugin manifest (plugin.json)

The plugin manifest. Every plugin has one, at the root of its folder.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `id` | [plugin id](#plugin-id) | yes | Unique on the instance, and the name of the plugin folder. Do not change it once tables use the plugin. |
| `name` | text (1–100 characters) | yes | The name admins and GMs see. |
| `version` | [version](#version) | yes | The plugin version, such as `1.0.0`. |
| `kind` | `"system"` | yes | Only game systems exist for now. |
| `coreApi` | text (1–100 characters) | yes | The core API versions the plugin works with, as a semver range such as `^0.1.0`. A server outside the range lists the plugin as unusable. |
| `description` | text (at most 2000 characters) |  | Shown on the plugin admin page. |
| `author` | text (at most 200 characters) |  |  |
| `license` | text (at most 100 characters) |  |  |
| `hasCode` | true or false | yes | True exactly when the plugin has a `code/` folder. Admins must acknowledge code before enabling the plugin. |
| `locales` | list of [locale](#locale) (at least 1 item) |  | The languages in `lang/`. Each needs its `lang/<locale>.json`. |
| `defaultLocale` | [locale](#locale) |  | The language whose text shows when the viewer's language lacks a key; one of `locales`. Defaults to the first of `locales`, then `en`. |

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
| `minimum` | number |  |  |
| `maximum` | number |  |  |
| `minLength` | integer, at least 0 |  |  |
| `maxLength` | integer, at least 0 |  |  |
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

<a id="item-type-data-schema"></a>

### Data schema

The entity's data: an object whose properties are fields.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | `"object"` | yes |  |
| `properties` | map from [identifier](#identifier) to [Field](#item-type-field) | yes |  |
| `required` | list of [identifier](#identifier) |  |  |
| `description` | text (at most 2000 characters) |  |  |

<a id="item-type-field"></a>

### Field

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `type` | one of `"string"`, `"integer"`, `"number"`, `"boolean"`, `"object"`, `"array"` | yes |  |
| `description` | text (at most 2000 characters) |  |  |
| `default` | any JSON value |  | The value new entities start with; it must fit the field. |
| `enum` | list of text or number (at least 1 item) |  | The allowed values; a `select` input offers them. |
| `minimum` | number |  |  |
| `maximum` | number |  |  |
| `minLength` | integer, at least 0 |  |  |
| `maxLength` | integer, at least 0 |  |  |
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
- [Node `rollButton`](#sheet-node-rollbutton): Rolls a recipe for the entity and posts it to chat.
- [Node `derived`](#sheet-node-derived): Shows a derived value.
- [Node `image`](#sheet-node-image): Shows a picture from a URL field.
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

Shows a picture from a URL field.

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
| `formula` | [formula](#formula) | yes | What to roll: dice and `@` references to the entity's data, `@derived`, `@args` and `@settings`. |
| `outcomes` | list of [Outcome](#rolls-outcome) |  | Checked in order; the first whose `when` is true is shown. |
| `card` | [name](#name) |  | A card in `cards/`, without `.json`, to show the roll with. |

<a id="rolls-handler-recipe"></a>

### Handler recipe

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) |  |  |
| `handler` | [name](#name) | yes | A handler in `code/server`, run on the server when the recipe is rolled. |

<a id="rolls-outcome"></a>

### Outcome

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `when` | [formula](#formula) |  | A true/false formula that can read `@total` and `@roll`; leave it out for the fallback. |
| `label` | [text](#text) | yes | Shown with the roll; a lang key or literal text. |
| `class` | [css classes](#css-classes) |  | A CSS class for the outcome, for `styles/*.css`. |

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
| `value` | [formula](#formula) | yes | Reads `@total`, `@roll.expression`, `@roll.resolved` and the entity's data. It cannot roll dice. |
| `class` | [css classes](#css-classes) |  |  |

<a id="settings"></a>

## Table settings (settings.json)

Options each table sets on its settings page, each under an identifier such as `startingHp`. Formulas read them as `@settings.<name>`.

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
| `type` | `"boolean"` | yes |  |
| `default` | true or false | yes |  |

<a id="settings-setting-integer"></a>

### Setting `integer`

A whole number.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `label` | [text](#text) | yes | A lang key or literal text. |
| `description` | [text](#text) |  | Help shown under the option. |
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
| `type` | `"string"` | yes |  |
| `default` | text | yes |  |
| `enum` | list of text (at least 1 item) |  | Offers these values to pick from. |
| `maxLength` | integer, at least 1 |  |  |

<a id="combat"></a>

## Combat (combat.json)

Initiative for the combat tracker. Checked, but not used until the tracker ships.

| Key | Value | Required | About |
| --- | --- | --- | --- |
| `$schema` | text |  | The URL or path of this JSON Schema, so editors check the file. |
| `initiative` | [formula](#formula) |  | What each combatant rolls for initiative. |
| `order` | one of `"desc"`, `"asc"`, `"sideBased"` |  |  |

<a id="lang"></a>

## Translations (lang/<locale>.json)

Texts by lang key, such as `"field.str": "Strength"`. The file name is the locale.

Every key is text (1–200 characters) and maps to text.
