# Writing plugins

The core of this tabletop knows nothing about any game. Everything specific to a game system comes from a **plugin**: the stats on a character sheet, the values computed from them, the dice a roll uses, and how a roll reads in chat. A plugin is a folder of JSON files, with optional CSS and optional code.

This guide has two parts:

- a [tutorial](#tutorial-build-your-first-plugin) that builds a small system from an empty folder to a sheet you can roll from;
- the [format](#the-plugin-format), file by file.

Every key of every file is listed in the [plugin file reference](plugin-reference.md), which is generated from the schemas the server validates with. Two finished plugins live in [`plugins/`](../plugins): `tiny-pool` (JSON only) and `tiny-d20` (with a custom sheet node in code).

> **What 0.1.0 runs.** JSON files, scoped CSS and client code (`code/client`) all work. `code/shared` and `code/server` are packed but **not run yet**, so plugins cannot add formula functions or roll handlers. Rolls defined by a `handler`, and calls to functions other than the [built-ins](#functions), fail when rolled. `combat.json` and `packs/` are reserved for later versions.

## Contents

- [Before you start](#before-you-start)
- [Tutorial: build your first plugin](#tutorial-build-your-first-plugin)
- [The plugin format](#the-plugin-format)
  - [Folder layout](#folder-layout)
  - [The manifest](#the-manifest)
  - [Actor and item types](#actor-and-item-types)
  - [Sheets](#sheets)
  - [Formulas](#formulas)
  - [Rolls](#rolls)
  - [Custom dice](#custom-dice)
  - [Chat cards](#chat-cards)
  - [Table settings](#table-settings)
  - [Translations](#translations)
  - [Styles](#styles)
  - [Plugin code](#plugin-code)
- [Checking, previewing and installing](#checking-previewing-and-installing)

## Before you start

You need a checkout of this repository with Node.js 24 and pnpm, set up as the [README](../README.md#getting-started) describes. Build it once, and give the plugin CLI a short name:

```bash
pnpm install
pnpm build
alias vtt-plugin="node $PWD/packages/plugin-cli/dist/src/bin.js"
```

Run the `alias` line from the repository root, and again in each new shell. `vtt-plugin help` lists the commands:

| Command                         | What it does                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `vtt-plugin validate <dir>`     | Checks a plugin folder exactly as the server does, and lists every problem with its file and key |
| `vtt-plugin dev <dir>`          | Opens a live preview of the plugin's sheets that reloads when you save                           |
| `vtt-plugin pack <dir>`         | Compiles the code, minifies the styles and writes the `.vttplugin` archive an admin installs     |
| `vtt-plugin schema --out <dir>` | Writes the JSON Schemas of plugin files, so your editor can check them as you type               |

## Tutorial: build your first plugin

We will build **Starter**, a tiny system with two stats, hit points, a defense value, gear and a 2d6 roll. Each step ends with a plugin that passes `vtt-plugin validate`, and each file is shown in full, so you can copy it over the previous version.

### Step 1: an empty plugin

Make a working folder with the JSON Schemas in it, and a folder for the plugin next to them:

```bash
mkdir -p ~/vtt-plugins/starter
vtt-plugin schema --out ~/vtt-plugins/schemas
cd ~/vtt-plugins/starter
```

Every plugin starts with a manifest, `plugin.json`, at the root of its folder:

```json file=plugin.json
{
  "$schema": "../schemas/plugin.schema.json",
  "id": "starter",
  "name": "Starter",
  "version": "0.1.0",
  "kind": "system",
  "coreApi": "^0.1.0",
  "description": "My first system.",
  "hasCode": false
}
```

- `id` is how the server knows the plugin. It must be unique on the instance, and the installed folder is named after it.
- `coreApi` says which versions of the core the plugin works with. This core provides `0.1.0`.
- `hasCode` must say whether the plugin has a `code/` folder. This one does not.
- `$schema` is optional. It points your editor at the schema, so it can flag mistakes and show what each key means. The server ignores it.

Check it:

```bash
vtt-plugin validate .
```

```text
starter 0.1.0: valid
```

### Step 2: a character type and its sheet

A system declares **actor types** (characters, monsters) and **item types** (weapons, spells). Each type says what data its entities hold, as a small subset of JSON Schema, and which sheet shows them.

Create `types/actors/hero.json`:

```json file=types/actors/hero.json
{
  "$schema": "../../../schemas/actor-type.schema.json",
  "label": "Hero",
  "controlledBy": "player",
  "sheet": "hero",
  "schema": {
    "type": "object",
    "properties": {
      "might": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "agility": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "hp": { "type": "integer", "default": 10, "minimum": 0, "x-counter": true },
      "notes": { "type": "string", "x-kind": "longText", "default": "" }
    }
  }
}
```

- `controlledBy: "player"` lets players create heroes; `"gm"` would leave that to the GM.
- `x-counter` marks `hp` as a number people change in steps. Steps from several people at once add up instead of overwriting each other.
- `x-kind: "longText"` makes `notes` shared text that several people can type into at once.
- The file name, `hero`, is the type's name. `sheet: "hero"` points at `sheets/hero.json`.

Now the sheet, `sheets/hero.json`. A sheet is a tree of nodes under `layout`: containers such as `column` and `row` hold fields and other nodes.

```json file=sheets/hero.json
{
  "$schema": "../../schemas/sheet.schema.json",
  "layout": {
    "type": "column",
    "gap": "md",
    "children": [
      {
        "type": "row",
        "gap": "md",
        "wrap": true,
        "children": [
          { "type": "field", "path": "might", "label": "Might", "input": "number" },
          { "type": "field", "path": "agility", "label": "Agility", "input": "number" },
          { "type": "field", "path": "hp", "label": "Hit points", "input": "counter" }
        ]
      },
      { "type": "longText", "path": "notes", "label": "Notes" }
    ]
  }
}
```

Each `field` edits the data at its `path`. The `counter` input adds − and + buttons.

Validate again, then open the preview:

```bash
vtt-plugin validate .
vtt-plugin dev .
```

The preview prints its address (`http://localhost:5180/` unless that port is taken). It shows the sheet with each field at its default, and it reloads whenever you save a file. Keep it open for the next steps.

If validation fails, the message names the file and the key. For example, a typo in a field path gives:

```text
  error   sheets/hero.json $.layout.children[0].children[1].path: "agilty" is not a field of actor type "hero"
starter 0.1.0: 1 errors, 0 warnings
```

### Step 3: a derived value

Some values follow from others, such as a defense of 10 plus agility. These are **derived values**: formulas the core computes and never stores. Add `derived` to the type:

```json file=types/actors/hero.json
{
  "$schema": "../../../schemas/actor-type.schema.json",
  "label": "Hero",
  "controlledBy": "player",
  "sheet": "hero",
  "schema": {
    "type": "object",
    "properties": {
      "might": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "agility": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "hp": { "type": "integer", "default": 10, "minimum": 0, "x-counter": true },
      "notes": { "type": "string", "x-kind": "longText", "default": "" }
    }
  },
  "derived": {
    "defense": "10 + @agility"
  }
}
```

`@agility` reads the field. Show the value with a `derived` node, and add a line that only appears while the hero is down, using `visibleIf`:

```json file=sheets/hero.json
{
  "$schema": "../../schemas/sheet.schema.json",
  "layout": {
    "type": "column",
    "gap": "md",
    "children": [
      {
        "type": "row",
        "gap": "md",
        "wrap": true,
        "children": [
          { "type": "field", "path": "might", "label": "Might", "input": "number" },
          { "type": "field", "path": "agility", "label": "Agility", "input": "number" },
          { "type": "field", "path": "hp", "label": "Hit points", "input": "counter" },
          { "type": "derived", "key": "defense", "label": "Defense" }
        ]
      },
      { "type": "text", "text": "Down and out!", "visibleIf": "@hp <= 0" },
      { "type": "longText", "path": "notes", "label": "Notes" }
    ]
  }
}
```

In the preview, change Agility and Defense follows. Step Hit points down to 0 and the line appears.

### Step 4: a roll

Rolls are **recipes** in `rolls.json`: a formula with dice, and the outcomes to report. This one rolls 2d6 plus a bonus that the button passes in:

```json file=rolls.json
{
  "$schema": "../schemas/rolls.schema.json",
  "check": {
    "label": "Check",
    "formula": "2d6 + @args.bonus",
    "outcomes": [
      { "when": "@total >= 10", "label": "Success", "class": "success" },
      { "when": "@total >= 7", "label": "Partial success" },
      { "label": "Miss" }
    ]
  }
}
```

Outcomes are checked in order. The first whose `when` is true wins, and one without `when` catches everything else. `@total` is the result of the roll.

Add a `rollButton` for each stat. `args` gives the recipe its `@args`:

```json file=sheets/hero.json
{
  "$schema": "../../schemas/sheet.schema.json",
  "layout": {
    "type": "column",
    "gap": "md",
    "children": [
      {
        "type": "row",
        "gap": "md",
        "wrap": true,
        "children": [
          { "type": "field", "path": "might", "label": "Might", "input": "number" },
          { "type": "field", "path": "agility", "label": "Agility", "input": "number" },
          { "type": "field", "path": "hp", "label": "Hit points", "input": "counter" },
          { "type": "derived", "key": "defense", "label": "Defense" }
        ]
      },
      {
        "type": "row",
        "gap": "sm",
        "children": [
          {
            "type": "rollButton",
            "roll": "check",
            "label": "Roll Might",
            "args": { "bonus": "@might" }
          },
          {
            "type": "rollButton",
            "roll": "check",
            "label": "Roll Agility",
            "args": { "bonus": "@agility" }
          }
        ]
      },
      { "type": "text", "text": "Down and out!", "visibleIf": "@hp <= 0" },
      { "type": "longText", "path": "notes", "label": "Notes" }
    ]
  }
}
```

The preview rolls with the same engine as the server and shows the result under the sheet. In a game, the server rolls and posts the result to the table's chat.

### Step 5: a list of gear

A **collection** is a list whose rows several people can add, remove and reorder at once. Declare it as an `array` of objects with `x-kind: "collection"`, and total the weights with `sum` over `[*]`, which reads a field from every row:

```json file=types/actors/hero.json
{
  "$schema": "../../../schemas/actor-type.schema.json",
  "label": "Hero",
  "controlledBy": "player",
  "sheet": "hero",
  "schema": {
    "type": "object",
    "properties": {
      "might": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "agility": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "hp": { "type": "integer", "default": 10, "minimum": 0, "x-counter": true },
      "gear": {
        "type": "array",
        "x-kind": "collection",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "default": "", "maxLength": 60 },
            "weight": { "type": "integer", "default": 1, "minimum": 0 }
          }
        }
      },
      "notes": { "type": "string", "x-kind": "longText", "default": "" }
    }
  },
  "derived": {
    "defense": "10 + @agility",
    "load": "sum(@gear[*].weight)"
  }
}
```

On the sheet, a `list` node shows the rows. Its `item` is the layout of one row, and paths inside it are relative to the row:

```json file=sheets/hero.json
{
  "$schema": "../../schemas/sheet.schema.json",
  "layout": {
    "type": "column",
    "gap": "md",
    "children": [
      {
        "type": "row",
        "gap": "md",
        "wrap": true,
        "children": [
          { "type": "field", "path": "might", "label": "Might", "input": "number" },
          { "type": "field", "path": "agility", "label": "Agility", "input": "number" },
          { "type": "field", "path": "hp", "label": "Hit points", "input": "counter" },
          { "type": "derived", "key": "defense", "label": "Defense" }
        ]
      },
      {
        "type": "row",
        "gap": "sm",
        "children": [
          {
            "type": "rollButton",
            "roll": "check",
            "label": "Roll Might",
            "args": { "bonus": "@might" }
          },
          {
            "type": "rollButton",
            "roll": "check",
            "label": "Roll Agility",
            "args": { "bonus": "@agility" }
          }
        ]
      },
      { "type": "text", "text": "Down and out!", "visibleIf": "@hp <= 0" },
      {
        "type": "section",
        "title": "Gear",
        "children": [
          {
            "type": "list",
            "path": "gear",
            "addLabel": "Add gear",
            "item": {
              "type": "row",
              "gap": "sm",
              "children": [
                { "type": "field", "path": "name", "label": "Item" },
                { "type": "field", "path": "weight", "label": "Weight", "input": "number" }
              ]
            }
          },
          { "type": "derived", "key": "load", "label": "Load" }
        ]
      },
      { "type": "longText", "path": "notes", "label": "Notes" }
    ]
  }
}
```

### Step 6: translations

So far every label is literal English. To offer more languages, use **lang keys**: names such as `field.might`, with at least one dot and no spaces, whose text lives in `lang/<locale>.json`. Any text without a dot or with a space stays literal, as before.

List the languages in the manifest:

```json file=plugin.json
{
  "$schema": "../schemas/plugin.schema.json",
  "id": "starter",
  "name": "Starter",
  "version": "0.1.0",
  "kind": "system",
  "coreApi": "^0.1.0",
  "description": "My first system.",
  "hasCode": false,
  "locales": ["en", "pt-BR"],
  "defaultLocale": "en"
}
```

Write the English texts in `lang/en.json`:

```json file=lang/en.json
{
  "type.hero": "Hero",
  "field.might": "Might",
  "field.agility": "Agility",
  "field.hp": "Hit points",
  "field.defense": "Defense",
  "field.notes": "Notes",
  "section.gear": "Gear",
  "gear.add": "Add gear",
  "gear.name": "Item",
  "gear.weight": "Weight",
  "gear.load": "Load",
  "hint.down": "Down and out!",
  "roll.check": "Check",
  "roll.might": "Roll Might",
  "roll.agility": "Roll Agility",
  "outcome.success": "Success",
  "outcome.partial": "Partial success",
  "outcome.miss": "Miss"
}
```

and the Brazilian Portuguese ones in `lang/pt-BR.json`:

```json file=lang/pt-BR.json
{
  "type.hero": "Herói",
  "field.might": "Força",
  "field.agility": "Agilidade",
  "field.hp": "Pontos de vida",
  "field.defense": "Defesa",
  "field.notes": "Anotações",
  "section.gear": "Equipamento",
  "gear.add": "Adicionar item",
  "gear.name": "Item",
  "gear.weight": "Peso",
  "gear.load": "Carga",
  "hint.down": "Fora de combate!",
  "roll.check": "Teste",
  "roll.might": "Testar Força",
  "roll.agility": "Testar Agilidade",
  "outcome.success": "Sucesso",
  "outcome.partial": "Sucesso parcial",
  "outcome.miss": "Falha"
}
```

Then swap the literal labels for the keys, in the type:

```json file=types/actors/hero.json
{
  "$schema": "../../../schemas/actor-type.schema.json",
  "label": "type.hero",
  "controlledBy": "player",
  "sheet": "hero",
  "schema": {
    "type": "object",
    "properties": {
      "might": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "agility": { "type": "integer", "default": 2, "minimum": 0, "maximum": 5 },
      "hp": { "type": "integer", "default": 10, "minimum": 0, "x-counter": true },
      "gear": {
        "type": "array",
        "x-kind": "collection",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "default": "", "maxLength": 60 },
            "weight": { "type": "integer", "default": 1, "minimum": 0 }
          }
        }
      },
      "notes": { "type": "string", "x-kind": "longText", "default": "" }
    }
  },
  "derived": {
    "defense": "10 + @agility",
    "load": "sum(@gear[*].weight)"
  }
}
```

in the recipe:

```json file=rolls.json
{
  "$schema": "../schemas/rolls.schema.json",
  "check": {
    "label": "roll.check",
    "formula": "2d6 + @args.bonus",
    "outcomes": [
      { "when": "@total >= 10", "label": "outcome.success", "class": "success" },
      { "when": "@total >= 7", "label": "outcome.partial" },
      { "label": "outcome.miss" }
    ]
  }
}
```

and in the sheet:

```json file=sheets/hero.json
{
  "$schema": "../../schemas/sheet.schema.json",
  "layout": {
    "type": "column",
    "gap": "md",
    "children": [
      {
        "type": "row",
        "gap": "md",
        "wrap": true,
        "children": [
          { "type": "field", "path": "might", "label": "field.might", "input": "number" },
          { "type": "field", "path": "agility", "label": "field.agility", "input": "number" },
          { "type": "field", "path": "hp", "label": "field.hp", "input": "counter" },
          { "type": "derived", "key": "defense", "label": "field.defense" }
        ]
      },
      {
        "type": "row",
        "gap": "sm",
        "children": [
          {
            "type": "rollButton",
            "roll": "check",
            "label": "roll.might",
            "args": { "bonus": "@might" }
          },
          {
            "type": "rollButton",
            "roll": "check",
            "label": "roll.agility",
            "args": { "bonus": "@agility" }
          }
        ]
      },
      { "type": "text", "text": "hint.down", "visibleIf": "@hp <= 0" },
      {
        "type": "section",
        "title": "section.gear",
        "class": "gear",
        "children": [
          {
            "type": "list",
            "path": "gear",
            "addLabel": "gear.add",
            "item": {
              "type": "row",
              "gap": "sm",
              "children": [
                { "type": "field", "path": "name", "label": "gear.name" },
                { "type": "field", "path": "weight", "label": "gear.weight", "input": "number" }
              ]
            }
          },
          { "type": "derived", "key": "load", "label": "gear.load" }
        ]
      },
      { "type": "longText", "path": "notes", "label": "field.notes" }
    ]
  }
}
```

The validator now checks that every key the plugin uses has an English text. A key missing in English is an error; one missing in another language is a warning, and English shows instead. Viewers see the plugin in their own language when it has one.

The sheet also gave the gear section a `class`, for the next step.

### Step 7: styles

Each CSS file in `styles/` applies to the plugin's own sheets and chat cards, and nothing else. Create `styles/sheet.css`:

```css file=styles/sheet.css
:root {
  --vtt-accent: #2f7d4f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --vtt-accent: #7ed3a0;
  }
}

.gear {
  border-left: 3px solid var(--vtt-accent);
  padding-left: var(--vtt-gap-sm);
}

.success {
  color: var(--vtt-accent);
  font-weight: 700;
}
```

`:root` here means the plugin's sheet, so `--vtt-accent` changes only this plugin's accent colour. `.success` styles the outcome that set `"class": "success"` in step 4.

### Step 8: pack, install and play

Pack the plugin:

```bash
vtt-plugin pack .
```

```text
Packed starter 0.1.0: 7 files, 2539 bytes → starter-0.1.0.vttplugin
```

Then, signed in to an instance as an admin:

1. Open **Plugins**, choose **Install plugin**, and pick `starter-0.1.0.vttplugin`.
2. Choose **Enable** on Starter. New plugins start disabled.
3. Under **Tables**, choose **New table** and pick Starter as the **Game system**.
4. On the table, create a hero with **New actor**, open it, and roll.

To try changes on your own instance without packing, copy the plugin folder into the instance's `DATA_DIR/plugins/` (the folder must be named after the plugin id) and press **Rescan** on the Plugins page.

That is the whole loop: edit, validate, preview, pack. The rest of this guide covers each file in depth.

## The plugin format

### Folder layout

```text
my-system/
├─ plugin.json              the manifest (required)
├─ types/
│  ├─ actors/<type>.json    actor types: data, derived values, sheet
│  └─ items/<type>.json     item types: the same, without controlledBy
├─ sheets/<name>.json       sheet layouts, named by types
├─ rolls.json               roll recipes
├─ dice.json                custom dice
├─ cards/<name>.json        how recipe rolls show in chat
├─ settings.json            options each table can change
├─ lang/<locale>.json       translations; English is required once any exist
├─ styles/<name>.css        scoped CSS
└─ code/client.tsx          custom sheet nodes and cards (optional)
```

Everything but `plugin.json` is optional. Other JSON files outside `code/` produce an `unknown_file` warning and are ignored. Dot files and `node_modules` are left out of packed archives.

Names of types, sheets, cards and recipes are [names](plugin-reference.md#name): letters, digits, `_` and `-`, starting with a letter. A file over 1 MB is not read, and a stylesheet over 256 KB is refused.

### The manifest

`plugin.json` describes the plugin; the [reference](plugin-reference.md#plugin) lists every key. The rules the validator adds:

- **`id`** is lowercase letters, digits and inner hyphens. An installed plugin's folder is named after it, and a plugin found in a folder with another name is refused. Tables store the id, so do not change it once tables use the plugin.
- **`coreApi`** is a semver range. A plugin whose range does not include the server's core API version (`0.1.0`) is listed but cannot be enabled.
- **`hasCode`** must be `true` exactly when there is a `code/` folder. Admins must acknowledge code before enabling a plugin that has it.
- **`locales`** lists the languages in `lang/`; each needs its file, and `en` is always required once there is any. **`defaultLocale`** is the language shown when the viewer's lacks a text.

### Actor and item types

A type file in `types/actors/` or `types/items/` defines one type, named after the file. It has:

- `label`: the type's name, as players see it;
- `sheet`: the sheet in `sheets/` that shows it;
- `schema`: the data each entity holds;
- `derived`: values computed from the data;
- `controlledBy` (actors only): `"player"` lets players create the type, `"gm"` leaves it to the GM.

#### Data

`schema` is an object whose `properties` are fields. Fields use a subset of JSON Schema:

| Keyword                   | Use                                                                         |
| ------------------------- | --------------------------------------------------------------------------- |
| `type`                    | `string`, `integer`, `number`, `boolean`, `object` or `array`               |
| `default`                 | The value new entities start with. It must fit the field's type and limits. |
| `minimum`, `maximum`      | Limits for numbers                                                          |
| `minLength`, `maxLength`  | Limits for text                                                             |
| `enum`                    | The allowed values, offered by a `select` input                             |
| `properties`              | The fields of an `object`                                                   |
| `items`                   | The rows of an `array`                                                      |
| `required`, `description` | As in JSON Schema                                                           |

`$ref`, `allOf`, `oneOf`, `anyOf`, `not`, `if`/`then`/`else` and `patternProperties` are refused. Field names are [identifiers](plugin-reference.md#identifier) (`strMod`, `hp`), so formulas can refer to them. Top-level fields cannot be named `derived`, `args`, `row`, `settings`, `total` or `roll`, which formulas use for other things.

Fields left without a `default` start empty (an empty text, zero or false), so give each field a sensible default.

Annotations change how the core stores and edits a field:

| Annotation               | On                  | Effect                                                                                                                    |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `"x-counter": true`      | `integer`, `number` | People change it in steps (`counter` input). Steps from several people at once add up.                                    |
| `"x-kind": "longText"`   | `string`            | Shared plain text: several people type into it at once without losing each other's words.                                 |
| `"x-kind": "richText"`   | `string`            | Shared rich text with a toolbar (bold, lists and so on). Formulas see its plain text.                                     |
| `"x-kind": "collection"` | `array` of `object` | Rows people add, remove and reorder at once. Each row also has an `id`.                                                   |
| `"x-kind": "image"`      | `string`            | A picture URL, shown by an `image` node.                                                                                  |
| `"x-layer": "secret"`    | any                 | Only the GM and assistants see the field. Players' browsers never receive it, and formulas a player rolls cannot read it. |

Other fields are plain values: the last write wins.

#### Derived values

`derived` maps names to [formulas](#formulas) without dice. They are computed on every change, shown by `derived` nodes, and read elsewhere as `@derived.<name>`. A derived value may use others; the validator refuses cycles.

```json
"derived": {
  "strMod": "floor((@str - 10) / 2)",
  "maxHp": "@settings.startingHp + @level - 1"
}
```

### Sheets

`sheets/<name>.json` holds one tree of nodes under `layout`. Every node has a `type`, and may have `class` (CSS classes) and `visibleIf` (a formula; the node shows only while it is true).

| Node            | Shows                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `column`, `row` | Children stacked, or side by side (`gap`: `none`, `sm`, `md`, `lg`; `row` can `wrap`)            |
| `grid`          | Children in up to `columns` columns (1–12), fewer when a column would be narrower than 7rem      |
| `tabs`          | One of several `tabs`, each with a `label` and `children`                                        |
| `section`       | A `title` over its `children`; `collapsible` lets viewers fold it                                |
| `field`         | An input for the field at `path`; `input` is `text`, `number`, `checkbox`, `select` or `counter` |
| `longText`      | The shared editor of a `longText` or `richText` field                                            |
| `list`          | The rows of an `array` field, each laid out by `item`, with add (`addLabel`), remove and reorder |
| `rollButton`    | A button that rolls the recipe `roll` with `args`                                                |
| `derived`       | The derived value `key`, as is or with `format`: `integer`, `signed` (`+2`) or `decimal`         |
| `image`         | The picture at the URL in field `path` (`size`: `sm`, `md`, `lg`)                                |
| `text`          | Static `text`                                                                                    |
| `custom:<name>` | A component from the plugin's [code](#plugin-code), given `props`                                |

The validator checks that each `path` exists and fits its node: a `checkbox` needs a boolean, a `select` a field with `enum`, a `counter` or `number` a number, and a `list` an array.

- **Paths** are dot paths from the entity's data, such as `hp.value`. Inside a `list`, paths are relative to the row.
- **Rows:** formulas inside a `list` read the row as `@row`, so `"args": { "id": "@row.id" }` tells a recipe which row was rolled.
- **Read-only and secret:** viewers who can only observe the entity see the sheet without inputs. Fields on the secret layer are not rendered for players at all, whatever `visibleIf` says.
- **Presence:** fields show who else is in them, so the core draws an outline and name badges over the field.

### Formulas

One small language is used for derived values, `visibleIf`, roll formulas, outcomes, roll arguments and card rows. It cannot run code: it reads values, does arithmetic and calls a fixed list of functions.

#### Values and references

Values are numbers, text in single quotes (`'str'`) and `true`/`false`. `@` reads a value:

| Reference                | Reads                                                                 | Available in                      |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------- |
| `@str`, `@hp.value`      | The entity's fields                                                   | Everywhere tied to a type         |
| `@derived.strMod`        | A derived value                                                       | Everywhere tied to a type         |
| `@settings.startingHp`   | A [table setting](#table-settings)                                    | Everywhere                        |
| `@skills['id'].rank`     | One row of a collection, by id                                        | Everywhere tied to a type         |
| `@skills[@args.id].rank` | The row a roll button named                                           | Recipes                           |
| `@skills[*].rank`        | That field of every row, as a list for `sum`, `min`, `max` or `count` | Everywhere tied to a type         |
| `@row.name`, `@row.id`   | The current row                                                       | Nodes inside a `list`             |
| `@args.bonus`            | A roll button's argument                                              | Recipes, their outcomes and cards |
| `@total`                 | The roll's result                                                     | Outcomes and card rows            |
| `@roll.expression`       | The formula as written                                                | Outcomes and card rows            |
| `@roll.resolved`         | The formula with values filled in: `1d20 + 2 + 3`                     | Outcomes and card rows            |

The validator checks every reference against the type that uses it: `@agilty` is an error that names the type.

#### Operators

From loosest to tightest:

| Operator                    | Meaning                                                   |
| --------------------------- | --------------------------------------------------------- |
| `cond ? a : b`              | `a` if `cond` is true, else `b`                           |
| `or`, `and`, `not`          | Logic on `true`/`false`                                   |
| `==` `!=` `<` `<=` `>` `>=` | Comparisons; they do not chain (`1 < @a < 3` is an error) |
| `+` `-`                     | Add or subtract numbers; `+` also joins two texts         |
| `*` `/` `%`                 | Multiply, divide, remainder                               |
| `-x`                        | Negation                                                  |

Types are strict: nothing converts silently, so `@str + 'x'` and `if(1, …)` are errors. Dividing by zero is an error. `and`, `or`, `?:` and `if` only evaluate the side they need.

#### Functions

| Function                                    | Result                                        |
| ------------------------------------------- | --------------------------------------------- |
| `floor(x)`, `ceil(x)`, `round(x)`, `abs(x)` | As in maths                                   |
| `min(…)`, `max(…)`                          | The smallest or largest of numbers or lists   |
| `sum(…)`                                    | The total of numbers or lists; `0` when empty |
| `count(@list[*])`                           | How many rows a collection has                |
| `clamp(x, low, high)`                       | `x` kept between `low` and `high`             |
| `if(cond, a, b)`                            | The same as `cond ? a : b`                    |

#### Dice

Dice belong only in roll formulas (recipes); anywhere else they are an error.

| Term         | Rolls                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `2d6`, `d20` | Dice, summed                                                                 |
| `(@pool)d6`  | A count from a formula; the `(` must touch the `d`                           |
| `4d6kh3`     | Keep the highest 3 (`kl`: lowest; `dh`, `dl`: drop highest or lowest)        |
| `3d6!`       | Exploding: a die showing its highest value adds another die                  |
| `2d20r1`     | Reroll a die showing 1, once (`r<3`, `r<=2` and so on also work)             |
| `5d10cs>=7`  | Count successes instead of summing (`cf` counts failures and subtracts them) |
| `4dF`        | A [custom die](#custom-dice) declared in `dice.json`                         |

Modifiers can be combined, once each, and apply in a fixed order: reroll, explode, keep or drop, then count. A roll may use up to 1,000 dice, explosions included.

#### Limits and errors

A formula is at most 2,000 characters and is checked when the plugin is validated, so syntax errors and unknown references never reach a game. Errors give the line and column. At run time, evaluation stops after 10,000 steps. A derived value whose formula fails shows `—`, with the error as its tooltip, and the rest of the sheet keeps working.

### Rolls

`rolls.json` maps recipe names to recipes:

```json
{
  "skill": {
    "label": "roll.skill",
    "formula": "1d20 + @derived.strMod + @skills[@args.id].rank",
    "outcomes": [
      { "when": "@total >= 15", "label": "outcome.success", "class": "ok" },
      { "label": "outcome.failure", "class": "fail" }
    ],
    "card": "skill"
  }
}
```

- `formula` is rolled on the server against the entity's current data. Rolls use a cryptographically secure random source, so players cannot predict or forge them.
- `outcomes` are checked in order. The first whose `when` is true wins, and one without `when` always matches. `class` styles the outcome in chat.
- `card` shows the roll with a [chat card](#chat-cards).
- A `rollButton` passes `args`, each a formula, number or `true`/`false`. The recipe reads them as `@args.<name>`.

### Custom dice

`dice.json` declares dice that formulas use by name. Names are `d` followed by capitals or digits, such as `dF` or `dB2`:

```json
{
  "dF": {
    "label": "dice.fate",
    "faces": ["-", "-", " ", " ", "+", "+"],
    "values": { "-": -1, " ": 0, "+": 1 }
  }
}
```

Faces are equally likely. A face is a number, a text label (whose number comes from `values`), or `{ "label": "…", "value": 1 }`. Totals, comparisons and success counting use the numbers, and chat shows the labels.

### Chat cards

A card in `cards/<name>.json` lays out a recipe's roll in chat:

```json
{
  "title": "card.skill.title",
  "rows": [
    { "label": "card.roll", "value": "@roll.resolved" },
    { "label": "card.total", "value": "@total", "class": "total" }
  ],
  "outcome": true
}
```

Each row's `value` is a formula that can read the roll (`@total`, `@roll.*`), the entity's data and `@args`. `outcome: true` shows the recipe's outcome. A component of the same name in `code/client` replaces the card's rendering.

### Table settings

`settings.json` declares house rules that each table's GM sets on the table settings page. Formulas read them as `@settings.<name>`:

```json
{
  "critFumble": { "type": "boolean", "default": true, "label": "setting.critFumble" },
  "startingHp": { "type": "integer", "default": 10, "minimum": 1, "label": "setting.startingHp" }
}
```

A setting is a `boolean`, `integer`, `number` or `string` (with optional `enum`), with a `default`, a `label` and an optional `description`.

### Translations

`lang/<locale>.json` maps lang keys to text. Wherever a file takes a label or text, the value is either:

- a **lang key**: words joined by dots, with no spaces, such as `field.str`. It shows the text in the viewer's language, else in `defaultLocale`;
- **literal text**: anything else, shown as written.

A plugin with no lang files can use literal text throughout. Once it has any, `lang/en.json` is required, and every key the plugin uses must have an English text. Keys missing in other languages are warnings.

### Styles

Each `styles/*.css` file is scoped by the server before it reaches a browser, so plugin CSS cannot affect the rest of the app:

- **Scope.** Every selector is prefixed with `[data-plugin="<id>"]`, which wraps the plugin's sheets and its chat cards. `:root` becomes that wrapper, so custom properties set there apply only to the plugin.
- **Layer.** All rules sit in `@layer plugin`, and each sheet gets `contain: layout paint`.
- **Removed, with a warning:** `@import` and other at-rules apart from `@media`, `@supports`, `@container`, `@layer`, `@font-face` and `@keyframes`; selectors naming `html` or `body`; `z-index` on `:root`; and URLs that leave the plugin folder. Keyframe names get the plugin id as a prefix.
- **URLs** relative to the stylesheet (fonts, images) are served from the plugin folder. External URLs are removed, but `data:` URLs are kept.

Hooks to style:

| Selector                                                    | Matches                             |
| ----------------------------------------------------------- | ----------------------------------- |
| a node's `class`                                            | That node                           |
| `[data-field="hp.value"]`                                   | The field node with that path       |
| `.vtt-field`, `.vtt-row`, `.vtt-section`, `.vtt-list-row` … | Every node of a type (`vtt-<type>`) |
| an outcome's `class`                                        | The outcome in chat                 |

Tokens to override in `:root`: `--vtt-accent` (the plugin's accent colour) and `--vtt-gap-sm`, `--vtt-gap-md`, `--vtt-gap-lg` (spacing). The app has light and dark schemes, so check your colours in both, for instance with `@media (prefers-color-scheme: dark)`.

### Plugin code

When JSON is not enough, `code/client.tsx` (or `.ts`, `.jsx`, `.js`) adds React components: custom sheet nodes, and card renderers that replace a JSON card. This is how `tiny-d20` draws its hit point bar:

```tsx
import { defineClient, useField, useTranslate, type NodeProps } from '@vtt/sdk/client';

function HpBar({ props }: NodeProps) {
  const [value] = useField('hp.value');
  const [max] = useField('hp.max');
  const t = useTranslate();
  const current = typeof value === 'number' ? value : 0;
  const top = typeof max === 'number' ? Math.max(1, max) : 1;
  return (
    <div className="hpBar" role="meter" aria-label={t('field.hp')} aria-valuenow={current}>
      {current} / {top}
    </div>
  );
}

export default defineClient({ nodes: { hpBar: HpBar } });
```

A sheet uses it as `{ "type": "custom:hpBar", "props": { … } }`; the component receives the node's `props`.

What client code gets from `@vtt/sdk/client`:

| API                              | Gives                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| `useField(path)`                 | `[value, set]` for a field; `set` does nothing for read-only viewers |
| `useDerived(key)`                | A derived value                                                      |
| `useActor()`                     | The entity's `id`, `name` and `type`                                 |
| `useTranslate()`                 | A function from lang keys to the viewer's text                       |
| `defineClient({ nodes, cards })` | Declares the components; the default export of `code/client`         |

Card components get `{ card, rolls, speaker, translate }`.

Rules:

- **Imports.** Code may import `react`, `react/jsx-runtime` and `@vtt/sdk/client`; the app provides them, so they are not bundled. Anything else you import is bundled into `code/client.js` by `vtt-plugin pack`. The server only loads the packed `.js`, so a plugin with code must be packed (or its `code/client.js` built) before an instance can run it.
- **No side channels.** Custom nodes read and write through the hooks. They should not open sockets or call the API.
- **Trust.** Code runs in every player's browser with their rights. That is why admins must acknowledge code when they enable a plugin, and why a replaced plugin with code starts disabled again.
- **Types.** The SDK is not published yet. To get type checking for plugin code, keep the plugin in this repository's `plugins/` folder, as `tiny-d20` does.

## Checking, previewing and installing

### Validation

`vtt-plugin validate <dir>` runs the server's own checks. Errors make a plugin unusable; warnings do not. Each line names the file and the JSON path:

```text
  error   rolls.json $.check.formula: @luck does not exist in actor type "hero"
  warning lang/pt-BR.json: pt-BR is not listed in the manifest's locales
```

It checks:

- every file against its [schema](plugin-reference.md), including unknown keys and keywords outside the data schema subset;
- defaults against their fields, and annotations against their types;
- every formula's syntax, references, functions and dice, and cycles among derived values;
- links between files: sheets, recipes, cards, derived values, field paths and the inputs they use;
- `coreApi`, `hasCode`, CSS, and lang keys.

### Preview

`vtt-plugin dev <dir> [--port <n>]` renders each type's sheet with its defaults, in memory. Pick the type to show, switch on **Read-only** to see what observers see, or **GM view** to show the secret layer, roll recipes, and edit freely; nothing is saved. Every saved file reloads the page.

### Packing

`vtt-plugin pack <dir> [--out <file>]` validates the plugin, compiles `code/` to ES modules, minifies the styles, validates the packed files again, and writes `<id>-<version>.vttplugin` (a ZIP). Archives are limited to 20 MB, 2,000 files and 50 MB unpacked.

### Installing and updating

Admins install a plugin in either of two ways:

- **Upload:** on the **Plugins** page, **Install plugin** takes a `.vttplugin`. Installing a plugin whose id is already installed asks before replacing it.
- **Folder:** copy the plugin folder into `DATA_DIR/plugins/<id>/` and press **Rescan**.

New plugins start disabled until an admin enables them. Disabling a plugin makes the tables that use it read-only until it is enabled again.

To update a plugin, raise `version` and install it again. Tables, actors and their data stay: entities keep their stored values, and new fields start at their defaults.
