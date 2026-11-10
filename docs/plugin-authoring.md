# Writing plugins

The core of this tabletop knows nothing about any game. Everything specific to a game system comes from a **plugin**: the stats on a character sheet, the values computed from them, the dice a roll uses, and how a roll reads in chat. A plugin is a folder of JSON files, with optional CSS and optional code.

This guide has two parts:

- a [tutorial](#tutorial-build-your-first-plugin) that builds a small system from an empty folder to a sheet you can roll from;
- the [format](#the-plugin-format), file by file.

Every key of every file is listed in the [plugin file reference](plugin-reference.md), which is generated from the schemas the server validates with. Two finished plugins live in [`plugins/`](../plugins): `tiny-pool` (JSON only) and `tiny-d20` (with a custom sheet node in code).

> **What runs.** JSON files, scoped CSS and all three kinds of [plugin code](#plugin-code) work: `code/client` in the browser, `code/shared` in both, and `code/server` on the server.

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
  - [Combat](#combat)
  - [Compendium packs](#compendium-packs)
  - [Data migrations](#data-migrations)
  - [Plugin settings](#plugin-settings)
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

### Step 8: an inventory

The gear list holds names and weights, but a shield that adds to defense is better as an **item**: its own entry, with its own fields and sheet, that the GM keeps in the table's library and gives to heroes. Declare an item type in `types/items/`:

```json file=types/items/armor.json
{
  "$schema": "../../../schemas/item-type.schema.json",
  "label": "Armor",
  "sheet": "armor",
  "schema": {
    "type": "object",
    "properties": {
      "worn": { "type": "boolean", "default": false },
      "protection": { "type": "integer", "default": 1, "minimum": 0, "maximum": 3 }
    }
  },
  "contributes": {
    "armor": { "formula": "@worn ? @protection : 0" }
  }
}
```

`contributes` is what each piece of armour adds to whoever holds it: its protection while worn. The contributions of all a hero's armour are added up, and the hero's formulas read the total as `@items.armor`. Every item type needs a sheet:

```json file=sheets/armor.json
{
  "$schema": "../../schemas/sheet.schema.json",
  "layout": {
    "type": "row",
    "gap": "sm",
    "children": [
      { "type": "field", "path": "worn", "label": "Worn", "input": "checkbox" },
      { "type": "field", "path": "protection", "label": "Protection", "input": "number" }
    ]
  }
}
```

Defense now counts the worn armour:

```json file=types/actors/hero.json
{
  "$schema": "../../../schemas/actor-type.schema.json",
  "label": "type.hero",
  "controlledBy": "player",
  "sheet": "hero",
  "schema": {
    "type": "object",
    "properties": {
      "might": {
        "type": "integer",
        "default": 2,
        "minimum": 0,
        "maximum": 5
      },
      "agility": {
        "type": "integer",
        "default": 2,
        "minimum": 0,
        "maximum": 5
      },
      "hp": {
        "type": "integer",
        "default": 10,
        "minimum": 0,
        "x-counter": true
      },
      "gear": {
        "type": "array",
        "x-kind": "collection",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "default": "",
              "maxLength": 60
            },
            "weight": {
              "type": "integer",
              "default": 1,
              "minimum": 0
            }
          }
        }
      },
      "notes": {
        "type": "string",
        "x-kind": "longText",
        "default": ""
      }
    }
  },
  "derived": {
    "defense": "10 + @agility + @items.armor",
    "load": "sum(@gear[*].weight)"
  }
}
```

and an `items` node shows the hero's armour on their sheet. Its `item` lays out one item, with paths into that item's fields, and the core adds buttons to open it, remove it, and add armour from the library:

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
          {
            "type": "field",
            "path": "might",
            "label": "field.might",
            "input": "number"
          },
          {
            "type": "field",
            "path": "agility",
            "label": "field.agility",
            "input": "number"
          },
          {
            "type": "field",
            "path": "hp",
            "label": "field.hp",
            "input": "counter"
          },
          {
            "type": "derived",
            "key": "defense",
            "label": "field.defense"
          }
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
            "args": {
              "bonus": "@might"
            }
          },
          {
            "type": "rollButton",
            "roll": "check",
            "label": "roll.agility",
            "args": {
              "bonus": "@agility"
            }
          }
        ]
      },
      {
        "type": "text",
        "text": "hint.down",
        "visibleIf": "@hp <= 0"
      },
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
                {
                  "type": "field",
                  "path": "name",
                  "label": "gear.name"
                },
                {
                  "type": "field",
                  "path": "weight",
                  "label": "gear.weight",
                  "input": "number"
                }
              ]
            }
          },
          {
            "type": "derived",
            "key": "load",
            "label": "gear.load"
          }
        ]
      },
      {
        "type": "section",
        "title": "Armor",
        "children": [
          {
            "type": "items",
            "itemTypes": ["armor"],
            "addLabel": "Add armor",
            "item": {
              "type": "row",
              "gap": "sm",
              "children": [
                {
                  "type": "field",
                  "path": "worn",
                  "label": "Worn",
                  "input": "checkbox"
                },
                {
                  "type": "field",
                  "path": "protection",
                  "label": "Protection",
                  "input": "number"
                }
              ]
            }
          }
        ]
      },
      {
        "type": "longText",
        "path": "notes",
        "label": "field.notes"
      }
    ]
  }
}
```

Ticking **Worn** on a row raises the hero's defense at once. The new labels are literal English; give them lang keys, as in step 6, to translate them. A recipe can also be [rolled with an item](#rolls-made-with-an-item), such as an attack that reads the sword it is made with.

### Step 9: pack, install and play

Pack the plugin:

```bash
vtt-plugin pack .
```

```text
Packed starter 0.1.0: 9 files, 3245 bytes → starter-0.1.0.vttplugin
```

The archive goes to the current folder, or wherever `--out <file>` says. Archives already in the plugin folder are left out of the new one.

Then, signed in to an instance as an admin:

1. Open **Plugins**, choose **Install plugin**, and pick `starter-0.1.0.vttplugin`.
2. Choose **Enable** on Starter. New plugins start disabled.
3. Under **Tables**, choose **New table** and pick Starter as the **Game system**.
4. On the table, create a hero with **New actor**, open it, and roll.
5. Under **Items**, create a piece of armour, then add it from the hero's sheet and mark it worn.

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
├─ settings.json            options for each table, the instance or each user
├─ combat.json              initiative for the combat tracker
├─ packs/<name>.json        compendium packs members browse and copy
├─ migrations/<version>.json  steps that bring older data up to a version
├─ lang/<locale>.json       translations; English is required once any exist
├─ theme.json               a module's colours, fonts and corners on the table page
├─ styles/<name>.css        scoped CSS
└─ code/client.tsx          custom sheet nodes and cards (optional)
```

Everything but `plugin.json` is optional. Other JSON files outside `code/` produce an `unknown_file` warning and are ignored. Dot files and `node_modules` are left out of packed archives.

Names of types, sheets, cards and recipes are [names](plugin-reference.md#name): letters, digits, `_` and `-`, starting with a letter. A file over 1 MB is not read, and a stylesheet over 256 KB is refused.

### The manifest

`plugin.json` describes the plugin; the [reference](plugin-reference.md#plugin) lists every key. The rules the validator adds:

- **`id`** is lowercase letters, digits and inner hyphens. An installed plugin's folder is named after it, and a plugin found in a folder with another name is refused. `vtt-plugin validate` does not check the folder name, since uploads name the folder for you. Tables store the id, so do not change it once tables use the plugin.
- **`coreApi`** is a semver range. A plugin whose range does not include the server's core API version (`0.1.0`) is listed but cannot be enabled.
- **`kind`** is `system` for a game system, which tables are created with, or `module` for an add-on GMs add to any table (see [Modules](#modules)).
- **`hasCode`** must be `true` exactly when there is a `code/` folder. Admins must acknowledge code before enabling a plugin that has it.
- **`locales`** lists the languages in `lang/`; each needs its file, and `en` is always required once there is any. **`defaultLocale`** is the language shown when the viewer's lacks a text.
- **`frames`** declares a module's overlays and panels (see [Overlays and panels](#overlays-and-panels)); a system cannot have it, and a module needs code for it.

### Actor and item types

A type file in `types/actors/` or `types/items/` defines one type, named after the file. It has:

- `label`: the type's name, as players see it;
- `sheet`: the sheet in `sheets/` that shows it;
- `schema`: the data each entity holds;
- `derived`: values computed from the data;
- `controlledBy` (required for actors, not allowed on items): `"player"` lets players create the type, `"gm"` leaves it to the GM.
- `labelPlural`, `group` and `order` (items only, all optional): how item lists group the type's items, described below.
- `contributes` (items only, optional): values the item adds to whoever holds it, described under [item contributions](#item-contributions).

#### Item groups

Item lists (the items panel, an actor's items and the compendium) can show items under headings, such as "Spells" and "Gear". Give an item type a `group`, a lang key or literal text, and every item of that type sits under it. Types with the same `group` share one heading:

```json
{
  "label": "type.spell",
  "labelPlural": "type.spells",
  "group": "group.spells",
  "order": 2,
  "sheet": "spell",
  "schema": { "type": "object", "properties": {} }
}
```

Once any item type has a `group`, a type without one gets a heading of its own: its `labelPlural`, or its `label` when it has none. Groups come by `order` (an integer, default 0; a group takes the lowest of its types), then by heading. In the compendium, actor entries come first under **Actors**. A system with no `group` keeps a single list.

#### Data

`schema` is an object whose `properties` are fields. Fields use a subset of JSON Schema:

| Keyword                   | Use                                                                         |
| ------------------------- | --------------------------------------------------------------------------- |
| `type`                    | `string`, `integer`, `number`, `boolean`, `object` or `array`               |
| `default`                 | The value new entities start with. It must fit the field's type and limits. |
| `minimum`, `maximum`      | Limits for numbers                                                          |
| `minLength`, `maxLength`  | Limits for text                                                             |
| `format: "dice"`          | Text that holds dice, such as `2d6 + 3`, or nothing; see `roll()`           |
| `enum`                    | The allowed values, offered by a `select` input                             |
| `properties`              | The fields of an `object`                                                   |
| `items`                   | The rows of an `array`                                                      |
| `required`, `description` | As in JSON Schema                                                           |

`$ref`, `allOf`, `oneOf`, `anyOf`, `not`, `if`/`then`/`else` and `patternProperties` are refused. Field names are [identifiers](plugin-reference.md#identifier) (`strMod`, `hp`), so formulas can refer to them. Top-level fields cannot be named `derived`, `args`, `row`, `settings`, `total`, `roll`, `items` or `item`, which formulas use for other things.

Fields left without a `default` start empty (an empty text, zero or false), so give each field a sensible default.

Annotations change how the core stores and edits a field:

| Annotation               | On                  | Effect                                                                                                                                                            |
| ------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"x-counter": true`      | `integer`, `number` | People change it in steps (`counter` input). Steps from several people at once add up.                                                                            |
| `"x-kind": "longText"`   | `string`            | Shared plain text: several people type into it at once without losing each other's words.                                                                         |
| `"x-kind": "richText"`   | `string`            | Shared rich text with a toolbar (bold, lists and so on). Formulas see its plain text.                                                                             |
| `"x-kind": "collection"` | `array` of `object` | Rows people add, remove and reorder at once. Each row also has an `id`.                                                                                           |
| `"x-kind": "image"`      | `string`            | A picture URL, shown by an `image` node, where editors pick one of the table's images or a web address.                                                           |
| `"x-layer": "secret"`    | any                 | Only the GM and assistants see the field, not even the player who owns the actor. Players' browsers never receive it, and formulas a player rolls cannot read it. |

Annotations combine: `{ "type": "string", "x-kind": "longText", "x-layer": "secret" }` is shared text only the GM and assistants see. Other fields are plain values: the last write wins.

A counter's `minimum` and `maximum` may be [formulas](#formulas) instead of numbers, such as `"maximum": "@hp.max"`, so healing stops at the maximum and spent slots at the slots a character has. They read the entity's fields, `@derived`, `@items` (on actors) and `@settings`, and are worked out on every step: from the sheet, from server code, and when someone types a value. A field inside a collection row reads the entity, not its row. A formula that fails bounds nothing. Only counters take formula bounds; the validator refuses them elsewhere.

#### Derived values

`derived` maps names to [formulas](#formulas) without dice. They are computed on every change, shown by `derived` nodes, and read elsewhere as `@derived.<name>`. A derived value may use others; the validator refuses cycles.

```json
"derived": {
  "strMod": "floor((@str - 10) / 2)",
  "maxHp": "@settings.startingHp + @level - 1"
}
```

#### Item contributions

An item can change its holder's numbers: worn armour raises defense, a prepared spell counts toward a limit. The item type declares what it **contributes**, and actor formulas read the totals over the actor's items as `@items.<name>`:

```json
// types/items/armor.json
"schema": { "type": "object", "properties": {
  "equipped": { "type": "boolean", "default": false },
  "acBonus": { "type": "integer", "default": 1 }
} },
"contributes": {
  "acBonus": { "formula": "@equipped ? @acBonus : 0" },
  "heaviest": { "formula": "@acBonus", "combine": "max", "default": 0 }
}
```

```json
// types/actors/character.json
"derived": { "ac": "10 + @derived.dexMod + @items.acBonus" }
```

Each contribution's `formula` reads the item's own fields and derived values, never dice, and `combine` says how the items' values add up:

| `combine`       | Values       | Total                   | With no item |
| --------------- | ------------ | ----------------------- | ------------ |
| `sum` (default) | numbers      | their sum               | 0            |
| `max`, `min`    | numbers      | the largest or smallest | `default`    |
| `any`           | true / false | true if one is          | false        |
| `count`         | true / false | how many are            | 0            |

`max` and `min` need a `default`; the others take none. Several item types may contribute the same name, such as armour and shields both adding to `acBonus`, as long as they combine it the same way. The validator checks this, refuses `@items` names no type contributes, and refuses `@items` in item formulas, so totals never depend on each other.

Only the actor's items count, not those in the trash, and an actor holds at most 500 items. Contributions read only fields every viewer of the item may see: a formula that reaches a `"x-layer": "secret"` field, directly or through a derived value, is refused, so totals never reveal secrets.

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
| `items`         | The actor's [items](#items-on-actor-sheets) of `itemTypes`, each laid out by `item`              |
| `rollButton`    | A button that rolls the recipe `roll` with `args`                                                |
| `derived`       | The derived value `key`, as is or with `format`: `integer`, `signed` (`+2`) or `decimal`         |
| `image`         | The picture at the URL in field `path` (`size`: `sm`, `md`, `lg`)                                |
| `text`          | Static `text`                                                                                    |
| `custom:<name>` | A component from the plugin's [code](#plugin-code), given `props`                                |

The validator checks that each `path` exists and fits its node: a `checkbox` needs a boolean, a `select` a field with `enum`, a `counter` or `number` a number, and a `list` an array.

- **Paths** are dot paths from the entity's data, such as `hp.value`. Inside a `list`, paths are relative to the row.
- **Rows:** formulas inside a `list` read the row as `@row`, so `"args": { "id": "@row.id" }` tells a recipe which row was rolled.
- **Read-only and secret:** viewers who can only observe the entity see the sheet without inputs. Fields on the secret layer are not rendered for players at all, whatever `visibleIf` says.
- **GM-only parts:** containers still render when everything in them is secret, so a tab or section holding only secret fields shows players its title and nothing else. No formula can tell who is viewing in 0.1.0, so `visibleIf` cannot hide it either. Put secret fields next to others (players simply do not see them), or accept the empty tab.
- **Presence:** fields show who else is in them, so the core draws an outline and name badges over the field.

#### Items on actor sheets

An `items` node shows the actor's own items on its sheet, so players equip armour or prepare spells where they play:

```json
{
  "type": "items",
  "itemTypes": ["armor", "shield"],
  "addLabel": "gear.add",
  "item": {
    "type": "row",
    "children": [
      { "type": "field", "path": "equipped", "input": "checkbox", "label": "field.equipped" },
      { "type": "field", "path": "acBonus", "input": "number", "label": "field.acBonus" },
      { "type": "field", "path": "weight", "visibleIf": "@item.type == 'armor'" }
    ]
  }
}
```

- **Which items:** those of `itemTypes`, or every item type when it is left out, under their [groups](#item-groups) and by name.
- **Rows:** `item` lays out one item. Its paths are relative to the item's data, and inputs edit the item itself, live, as on its own sheet. Formulas in a row still read the actor, and read the row's item as `@item`: its fields, its derived values (`@item.derived.<name>`), its `id`, `name` and `type`. So `"visibleIf": "@item.versatileDie > 0"` shows a node only for versatile weapons, and `args` can pass the item's data to a recipe.
- **Validation:** every path in `item` must exist in every listed type. A node whose `visibleIf` is `@item.type == 'armor'` (or several such tests joined by `or`) is only checked against those types.
- **Rolls:** a `rollButton` in a row rolls for the actor with the row's item, for recipes [made with an item](#rolls-made-with-an-item).
- **Actions:** the core shows each item's name above its row, so `item` need not lay it out. It adds a button to open each item's own sheet and, for whoever may edit the actor, to remove it and to add one from the table's library (`addLabel` names the button). Items dragged from the library or the compendium can be dropped onto the node.
- **Totals follow:** [item contributions](#item-contributions) come from the items as they are edited, so ticking "equipped" changes the actor's derived values at once.
- **Limits:** only actor sheets have `items` nodes, and not inside a `list` or another `items` node. An item's secret fields show on its own sheet only.

### Formulas

One small language is used for derived values, `visibleIf`, roll formulas, outcomes, roll arguments and card rows. It cannot run code: it reads values, does arithmetic and calls a fixed list of functions.

#### Values and references

Values are numbers, text in single quotes (`'str'`) and `true`/`false`. `@` reads a value:

| Reference                | Reads                                                                 | Available in                         |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------ |
| `@str`, `@hp.value`      | The entity's fields                                                   | Everywhere tied to a type            |
| `@derived.strMod`        | A derived value                                                       | Everywhere tied to a type            |
| `@settings.startingHp`   | A [table setting](#plugin-settings)                                   | Everywhere                           |
| `@items.acBonus`         | A total of the actor's [items](#item-contributions)                   | Everywhere tied to an actor type     |
| `@skills['id'].rank`     | One row of a collection, by id                                        | Everywhere tied to a type            |
| `@skills[@args.id].rank` | The row a roll button named                                           | Recipes                              |
| `@skills[*].rank`        | That field of every row, as a list for `sum`, `min`, `max` or `count` | Everywhere tied to a type            |
| `@row.name`, `@row.id`   | The current row                                                       | Nodes inside a `list`                |
| `@args.bonus`            | A roll button's argument                                              | Recipes, their outcomes and cards    |
| `@item.bonus`            | The item the roll is [made with](#rolls-made-with-an-item)            | Recipes with `item`, outcomes, cards |
| `@total`                 | The roll's result                                                     | Outcomes and card rows               |
| `@roll.expression`       | The formula as written                                                | Outcomes and card rows               |
| `@roll.resolved`         | The formula as rolled: `1d20 + 2 + 3` (see below)                     | Outcomes and card rows               |
| `@roll.natural`          | The first d20 that counts, as rolled: `2d20kh1` gives the higher one  | Outcomes and card rows               |
| `@roll.dice[0].kept[*]`  | The values of a dice term that count, as a list; `.total`, `.formula` | Outcomes and card rows               |
| `@let.bonus`             | A recipe's [named value](#named-values-and-several-rolls)             | Recipes, their outcomes and cards    |
| `@rolls.attack.total`    | A [named formula](#named-values-and-several-rolls) rolled earlier     | Recipes, their outcomes and cards    |
| `@options.mode`          | What the player chose when rolling ([roll options](#roll-options))    | Recipes, their outcomes and cards    |

The validator checks every reference against the type that uses it: `@agilty` is an error that names the type.

`@roll.resolved`, which the chat shows next to every roll, is the formula as it was rolled: references hold the values they read, dice their counts and sizes, each `?:` and `if()` only the branch it took, each `roll()` the dice it rolled, and `+ 0` is left out. `(@item.dice)d(@item.die) + (@item.finesse ? @derived.dexMod : @derived.strMod) + @item.magic` reads `1d8 + 3` for a mundane longsword.

#### Operators

From loosest to tightest:

| Operator                    | Meaning                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `cond ? a : b`              | `a` if `cond` is true, else `b`                                    |
| `or`, `and`, `not`          | Logic on `true`/`false`                                            |
| `==` `!=` `<` `<=` `>` `>=` | Comparisons; they do not chain (`1 < @a < 3` is an error)          |
| `+` `-`                     | Add or subtract numbers; `+` also joins text with text or a number |
| `*` `/` `%`                 | Multiply, divide, remainder                                        |
| `-x`                        | Negation                                                           |

Types are strict: nothing converts silently, except that `+` writes a number into text (`@dice + 'd' + @die` gives `2d6`), so `'a' + true` and `if(1, …)` are errors. Dividing by zero is an error. `and`, `or`, `?:` and `if` only evaluate the side they need.

#### Functions

| Function                                    | Result                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| `floor(x)`, `ceil(x)`, `round(x)`, `abs(x)` | As in maths                                                    |
| `min(…)`, `max(…)`                          | The smallest or largest of numbers or lists                    |
| `sum(…)`                                    | The total of numbers or lists; `0` when empty                  |
| `count(@list[*])`                           | How many rows a collection has                                 |
| `clamp(x, low, high)`                       | `x` kept between `low` and `high`                              |
| `if(cond, a, b)`                            | The same as `cond ? a : b`                                     |
| `text(x)`                                   | A number or `true`/`false` as text: `'3'`                      |
| `signed(x)`                                 | A number as text with its sign: `'+3'`, `'-1'`, `'+0'`         |
| `roll(text)`, `roll(text, n)`               | Rolls the dice a text holds; only in rolls (see [Dice](#dice)) |

A plugin can add its own functions in [`code/shared`](#shared-code).

#### Dice

Dice belong only in roll formulas (recipes); anywhere else they are an error.

| Term                  | Rolls                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `2d6`, `d20`          | Dice, summed                                                                 |
| `(@pool)d6`           | A count from a formula; the `(` must touch the `d`                           |
| `(@n)d(@item.die)`    | A size from a formula too: a whole number from 1 to 1,000,000                |
| `4d6kh3`              | Keep the highest 3 (`kl`: lowest; `dh`, `dl`: drop highest or lowest)        |
| `3d6!`                | Exploding: a die showing its highest value adds another die                  |
| `2d20r1`              | Reroll a die showing 1, once (`r<3`, `r<=2` and so on also work)             |
| `5d10cs>=7`           | Count successes instead of summing (`cf` counts failures and subtracts them) |
| `(@args.pool)d6cs>=5` | A pool: as many d6 as the argument says, counting 5s and 6s                  |
| `4dF`                 | A [custom die](#custom-dice) declared in `dice.json`                         |

A text field with `"format": "dice"` holds dice a player or GM types, such as a weapon's extra damage: `2d6 + 3`. It accepts numbers, dice and `+ - * /` only, or nothing; the sheet refuses anything else and so does the server. `roll(@item.extraDamage)` rolls it as part of the formula, and an empty one rolls `0`. `roll(text, 2)` doubles every die count but not the numbers, as critical hits do in many games: `1d8 + 3` rolls as `2d8 + 3`. Its dice count toward the roll's limit.

With `cs` or `cf`, a term is worth its successes minus its failures, so the `@total` of `(@args.pool)d6cs>=5` is the number of successes. Modifiers can be combined, once each, and apply in a fixed order: reroll, explode, keep or drop, then count. A roll may use up to 1,000 dice, explosions included.

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
- A recipe can instead name a handler, `{ "handler": "attack" }`, which [server code](#server-code) runs.
- `then` names a handler that runs after the roll is posted, such as one that spends the spell slot a spell was cast with. See [What a roll does next](#what-a-roll-does-next).
- A `rollButton` passes `args`, each a formula, number or `true`/`false`. The recipe reads them as `@args.<name>`. The validator cannot tell which arguments a recipe needs, so it does not check them: a button that leaves one out, or misspells it, validates, and its roll fails with an error naming the missing reference. Give every button of a recipe the same argument names.

#### Rolls made with an item

An attack with a sword reads the sword. A recipe that lists item types in `item` is made with one of the actor's items, and reads it as `@item`:

```json
"attack": {
  "formula": "1d20 + @derived.strMod + @item.bonus",
  "card": "attack",
  "item": ["weapon"]
}
```

- `@item.<field>` reads the item's fields, with their defaults, and `@item.derived.<name>` its derived values; `@item.id`, `@item.name` and `@item.type` name it. The validator checks every read against each listed type. The recipe, its outcomes and its card read `@item`, so a card row can show `@item.damage`.
- Its buttons go in an [`items` row](#items-on-actor-sheets) of a listed type, or on the sheet of a listed item type. Either way the actor holding the item rolls. The validator refuses its buttons anywhere else, and a button on an item sheet whose recipe takes no item.
- An item sheet's buttons are checked against every actor type, since any actor may hold the item. A library item has no holder, so its sheet rolls nothing.
- The server checks that the actor holds the item and that the recipe takes its type. It reads the item as its sheet shows it, live, and never its secret fields.
- Handler recipes take `item` too. The handler then gets the item as `item`.

#### Named values and several rolls

An attack rolls to hit, then its damage, doubled on a critical hit. One recipe does it all:

```json
"attack": {
  "actors": ["character"],
  "item": ["weapon"],
  "let": {
    "mod": "@item.finesse ? max(@derived.strMod, @derived.dexMod) : @derived.strMod",
    "toHit": "@let.mod + @derived.prof"
  },
  "formula": {
    "attack": "1d20 + @let.toHit",
    "damage": "(@rolls.attack.natural == 20 ? 2 : 1)d(@item.die) + @let.mod"
  },
  "outcomes": [{ "when": "@rolls.attack.natural == 20", "label": "outcome.crit" }],
  "card": "attack"
}
```

- `let` names values, worked out in order before anything is rolled. They cannot roll dice. The formulas, outcomes and card read them as `@let.<name>`, and each reads the ones before it, so a bonus is written once.
- `formula` can name several formulas instead of one. They are rolled in order into one chat message; each reads those before it as `@rolls.<name>`, with `total`, `natural`, `resolved`, `expression` and `dice`. Outcomes and the card read them all. `@total` and `@roll` are the first. A recipe rolls at most 10 formulas.
- `@roll.natural` is the die that counts of the first d20 term, so a natural 20 is `@roll.natural == 20` whatever the bonus. A roll without a d20 has none, and reading it is an error.
- `actors` lists the actor types a recipe is for. The validator checks the recipe against those types only, refuses its buttons on sheets of other actor types, and the server refuses it for other actors. Handler recipes take `actors` too.

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

**Die names.** A roll names each of its dice: standard dice are `d<sides>` (`d6`, `d20`, `d100`, and any other size, such as `d7`), and custom dice keep their name from `dice.json` (`dF`). Each result of a custom die also carries its face's `label`. Modules see the same names, and get the table system's custom dice with [`useSystemDice()`](#overlays-and-panels).

#### Roll options

Some things are chosen when rolling: Advantage, the slot a spell is cast with, Bless's 1d4. A recipe lists them in `options`, and its button asks for them:

```json
"cast": {
  "item": ["spell"],
  "options": {
    "mode": {
      "type": "choice",
      "label": "option.mode",
      "choices": [
        { "value": "normal", "label": "mode.normal" },
        { "value": "advantage", "label": "mode.advantage", "key": "shift" },
        { "value": "disadvantage", "label": "mode.disadvantage", "key": "ctrl" }
      ]
    },
    "slot": {
      "type": "number",
      "label": "option.slot",
      "default": "@item.level",
      "minimum": "@item.level",
      "maximum": 9
    },
    "bonus": { "type": "dice", "label": "option.bonus" }
  },
  "formula": "(@options.mode == 'advantage' ? 2d20kh1 : @options.mode == 'disadvantage' ? 2d20kl1 : 1d20) + roll(@options.bonus)"
}
```

- **Kinds:** a `choice` of up to 10 values (the first is picked unless `default` names another), a whole `number`, or `dice` such as `1d4` (blank by default, and only numbers, dice and arithmetic). The formulas, named values, outcomes and card read them as `@options.<name>`; `roll(@options.bonus)` rolls the dice, and blank dice add nothing.
- **Bounds:** a number's `default`, `minimum` and `maximum` are whole numbers or formulas worked out for the roll, so they can read `@item`, `@args` and the actor, but not other options.
- **Asking:** pressing the button opens a dialog with each option at its default. A choice with `key` is picked by holding that key (`shift`, or `ctrl`, which is also ⌘ on a Mac) while clicking: the roll goes at once, with the other options at their defaults. Each key picks one choice per recipe. Members who turn off **Ask for roll options** for a table, on their own row of its member list, roll there at once with a click, every option at its default; Alt-click then opens the dialog.
- **Checks:** the server checks every value against the declaration and refuses the roll otherwise, so a player cannot send a level 12 slot or dice that read the sheet. Recipes without options take none, and handler recipes take none yet.

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

### Combat

`combat.json` lets the GM roll initiative in the combat tracker:

```json
{ "initiative": "1d20 + @derived.dexMod", "order": "desc" }
```

`initiative` is a formula each combatant rolls against its actor's data, with the plugin's functions and dice. Each roll goes to the chat; a hidden combatant's goes to the GM only. Free-form combatants roll without data, so a formula that reads data skips them, and the GM types their initiative.

`order` is the turn order:

| `order`          | Turn order                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `desc` (default) | Highest initiative first                                                                      |
| `asc`            | Lowest first                                                                                  |
| `sideBased`      | The side with the best roll acts first, then the other, each highest first; players win a tie |

Combatants without initiative go last, and ties go in the order they were added. A combatant's side is its actor type's `controlledBy`; free-form combatants are on the GM's side. Server code can [order the turns](#combat-hooks) instead.

### Compendium packs

A pack holds ready-made actors and items of the plugin's own types. Every member of a table browses them in the Compendium panel, with a preview of each entry's sheet. GMs and assistants copy entries into the table, and anyone copies items onto an actor they own:

```json
{
  "label": "pack.bestiary",
  "entries": [
    { "id": "goblin", "kind": "actor", "type": "npc", "name": "Goblin", "data": { "str": 8 } },
    { "id": "club", "kind": "item", "type": "weapon", "name": "Club", "data": { "damage": "1d6" } }
  ]
}
```

- **`id`** is a [name](plugin-reference.md#name), unique in the pack. Keep it the same across versions: copies remember it, so the Compendium panel marks the entries a table already has. Copies are not changed when a later version changes the entry.
- **`kind`** is `actor` or `item`, and **`type`** one of the plugin's types of that kind.
- **`data`** is checked against the type's schema, like defaults; what it leaves out takes the defaults. Collections are lists of rows, as in defaults.
- **`label`** names the pack in the panel's pack filter; a lang key or text.

Copied actors belong to whoever copies them, so players see a GM's copies only once the GM shares them. Items copied into the table go to its library. Players see every entry in the panel, but not its secret fields: keep surprises in GM-only fields. A pack may hold 1,000 entries.

### Data migrations

When a version changes how a type stores its data, ship a migration so actors and items made with older versions follow. A file in `migrations/` is named after the version it brings data up to, and lists steps run in order:

```json
{
  "steps": [
    { "op": "rename", "kind": "actor", "type": "character", "path": "skills.*.lvl", "to": "rank" },
    { "op": "move", "kind": "actor", "type": "character", "path": "wounds", "to": "hp.value" },
    { "op": "setDefault", "kind": "actor", "type": "character", "path": "edition", "value": "1e" },
    { "op": "drop", "kind": "actor", "type": "character", "path": "legacy" }
  ]
}
```

- **`rename`** gives a field a new name where it is; **`move`** carries its value to another path, creating objects on the way; **`setDefault`** gives a field a value where an entity has none, such as the value existing entities should get for a new field whose default is meant for new ones; **`drop`** removes a field.
- **`path`** is field names joined by dots. `*` stands for every row of a collection, and a `move` keeps a value in its row. A step does nothing to an entity without the field, and replaces a value already at its target.
- **`kind`** and **`type`** name the entities a step changes; each step changes one type.

When a GM upgrades a table to a new version, each actor and item, trash included, runs every migration after the version it was made with, up to the table's new one, oldest first; then the [`migrate` hook](#migrate-hook) if the system has one. The result must fit the type's schema. One that does not, or a step that meets a value it cannot reach inside, leaves the entity as it was: the GM sees which failed and why, and can **Migrate again** from the table settings once the data or the plugin is fixed. Every other entity moves on, and its sheet stops showing the older-version notice. An actor's sheet history keeps what it was before, so a GM can go back.

Migrations only run forwards: data from a newer version than the table's, after a downgrade, is left as it is. A migration file may not be named after a version later than the manifest's. Browsers never receive migrations.

### Plugin settings

`settings.json` declares options. By default each is a house rule that the table's GM sets on the table settings page, and formulas read it as `@settings.<name>`:

```json
{
  "critFumble": { "type": "boolean", "default": true, "label": "setting.critFumble" },
  "startingHp": { "type": "integer", "default": 10, "minimum": 1, "label": "setting.startingHp" }
}
```

A setting is a `boolean`, `integer`, `number` or `string` (with optional `enum`), with a `default`, a `label` and an optional `description`.

A setting's `scope` says who sets it (ADR-075):

- **`table`**, the default: the GM, for one table.
- **`instance`**: admins, on the Plugins page, for every table on the server.
- **`user`**: each member, for themselves, under **My settings** in the table's Settings panel. It applies at every table that uses the plugin.

```json
{
  "showSecretRolls": { "type": "boolean", "default": false, "label": "setting.secret" },
  "maxQuality": {
    "type": "string",
    "default": "high",
    "enum": ["low", "high"],
    "label": "setting.quality",
    "scope": "instance"
  },
  "colour": { "type": "string", "default": "#c33", "label": "setting.colour", "scope": "user" }
}
```

Formulas read only `table` settings: the validator reports `@settings.colour` above as an unknown reference, since its value differs from one viewer to the next.

### Modules

A plugin with `"kind": "module"` extends any table, whatever its system (FR-PLUGIN-16, ADR-075). Admins enable it on the Plugins page as they enable systems, and each table's GM adds it in the table's Settings panel, under **Modules**. Members load a table's modules with the table.

A module may have `plugin.json`, `settings.json`, `lang/`, `styles/` and `code/client.js`. It cannot change a system's data or rules, so it may not have `types/`, `sheets/`, `cards/`, `packs/`, `migrations/`, `rolls.json`, `dice.json`, `combat.json`, `code/server.js` or `code/shared.js`; the validator refuses them (`module_file`). A module draws things on the table page through [overlays and panels](#overlays-and-panels).

#### Themes

A module's `theme.json` changes the app's look on the table page while the module is on (ADR-076). `plugins/parchment-skin` is a complete example.

```json
{
  "light": { "canvas": "#efe4c8", "fg": "#2b1d0e", "primary": "#7a3b12" },
  "dark": { "canvas": "#1c1711", "fg": "#efe4c8", "primary": "#d9a066" },
  "font": "Georgia, \"Palatino Linotype\", serif",
  "radius": "0.125rem",
  "border": "2px",
  "density": 0.9,
  "fonts": [{ "family": "Fell", "src": "fonts/fell.woff2" }],
  "panelBackground": { "light": "images/parchment.png" },
  "background": "images/wood.webp"
}
```

- **`light` and `dark`** set colour tokens for each scheme: `canvas` (the page), `surface` (cards, panels, inputs), `fg` (text), `muted` (secondary text), `line` (borders), `primary`, `primaryHover` and `onPrimary` (buttons and links), `danger`, `dangerSoft` and `infoSoft`, and `panel`, the colour behind docked panels. Tokens you leave out, and a scheme you leave out, keep the app's. Check that text keeps enough contrast in both.
- **`font`** is the text font, as a CSS font list. **`fonts`** loads fonts from the module's files (`.woff2`, `.woff`, `.ttf` or `.otf`) under the family names `font` and your stylesheets use.
- **`radius`** is the corner of cards, panels and inputs (`0` for square ones); smaller and larger corners scale with it.
- **`border`** is the width of thin borders, around cards, inputs and panels, such as `2px` (`0` for none). Their colour is `line`.
- **`density`** scales paddings and gaps everywhere, from `0.75` (compact) to `1.5` (roomy); `1` is the app's.
- **`panelBackground`** is an image of the module (PNG, JPEG, GIF, WebP or AVIF), tiled inside panels over their `panel` colour: one for both schemes, or one per scheme (`{ "light": …, "dark": … }`). Keep `panel` close to the image's colour, since it shows while the image loads. This suits textures such as paper or leather.
- **`background`** is an image tiled behind the table page, one or one per scheme as well. Docked panels cover it with their `panel` colour; make that `transparent`, or a colour with some transparency such as `rgb(248 241 223 / 0.5)`, to show one picture across the whole page. Floating panels stay opaque.

Values are checked strictly: colours are hex codes, colour names or colour functions such as `rgb(120 60 20)`; anything else, such as `url()`, is refused.

#### Named parts

Module stylesheets (`styles/*.css`) style named parts of the table page, which carry `data-vtt-part`. The names stay the same across versions:

| Part            | What it is                               |
| --------------- | ---------------------------------------- |
| `table`         | The whole table page                     |
| `table-header`  | The bar with the table's name and Panels |
| `workspace`     | The area that holds the panels           |
| `tab`           | A panel's tab                            |
| `panel`         | A panel's content, for most panels       |
| `chat`          | The chat panel                           |
| `chat-message`  | One chat message                         |
| `chat-composer` | The form that sends messages and rolls   |
| `map`           | The map panel                            |
| `map-toolbar`   | The map's tools                          |
| `sheet`         | An actor's or item's sheet               |

```css
[data-vtt-part='chat-message'] {
  border-left: 3px solid var(--color-primary);
}
:root {
  --color-line: #c4ab7f;
}
```

Every selector must name a part, or be `:root` alone, which sets tokens for the page; others are removed with a warning (`css_part_required`), and a part name that does not exist is a warning too. Rules apply only on tables that use the module, in `@layer module`, after a system's sheet styles. The other rules of [Styles](#styles) hold: no `@import`, no `html` or `body`, and URLs only inside the module. The app's own classes inside a part are not part of the API and may change.

#### Overlays and panels

A module's `code/client.js` can export overlays, drawn over the whole table page, and panels, which members open from the **Panels** menu and dock like Chat (ADR-077). `plugin.json` declares each one under `frames`, so the app knows them without running the code (ADR-079):

```json
"frames": {
  "overlays": { "lastRoll": {} },
  "panels": { "tools": { "title": "panel.tools" } }
}
```

The code exports a component under each declared name; a declared one it lacks shows as failed, and one it exports but `plugin.json` does not declare never shows. Each runs in its own sandboxed frame, as sheet nodes do (see [Plugin code](#plugin-code)): it cannot reach the page, cookies, storage or the network. It learns about the table only through these hooks from `@vtt/sdk/client`, and acts only as the viewer.

```js
import { useState } from 'react';
import { jsx } from 'react/jsx-runtime';
import { defineClient, useActions, useModuleSettings, useTableEvents } from '@vtt/sdk/client';

function LastRoll() {
  const [total, setTotal] = useState(null);
  const [settings] = useModuleSettings();
  useTableEvents((event) => {
    if (event.type === 'chat.message' && event.message.rolls.length > 0) {
      setTotal(event.message.rolls[0].total);
    }
  });
  return jsx('p', { className: 'last', children: `${settings.label}: ${total ?? '–'}` });
}

function Tools() {
  const actions = useActions();
  return jsx('button', { type: 'button', onClick: () => actions.roll('1d20'), children: 'Roll' });
}

export default defineClient({
  overlays: { lastRoll: { component: LastRoll } },
  panels: { tools: { component: Tools } },
});
```

- **Overlays** cover the page, with a transparent background. Clicks pass through them to the page, unless `plugin.json` declares the overlay `"interactive": true`; then it takes every click over the page, so keep interactive overlays rare. Each member can turn a table's overlays off with **Overlays** in the table's header; the choice is kept in their browser.
- **Panels** have a `title` in `plugin.json`, a lang key or text, shown in the Panels menu and on the tab. A panel stays loaded while another tab is in front of it, so it keeps hearing the table.
- **`useTableEvents(listener)`** calls `listener` with each table event the viewer can see. The server has already decided and filtered each one, so a whisper or a GM-only roll reaches only the frames of those who see it in the chat:
  - `chat.message` and `chat.updated` come with the `message`, including its `rolls` with dice and totals;
  - `chat.deleted` comes with the message `id`;
  - `combat.updated`, `scene.updated` and `token.updated` (with `sceneId`) say only that something changed.

  The chat never waits for a frame. A frame shows results; it never decides them.

- **`useModuleSettings()`** returns the module's settings for the viewer, with each setting's value taken from its scope (instance, table or user), and a setter. The frame redraws when the viewer's or the GM's settings change. The setter changes only the viewer's own `user` settings; the server refuses the others.
- **`useViewer()`** returns the viewer's `id`, `role` and the `tableId`.
- **`useActions()`** acts as the viewer: `sendChat(text, options)`, `roll(formula, options)` (options: `audience`, `recipientIds`, `actorId`), `openSheet(actorId)`, `openJournal(entryId)`, `combat('start' | 'end' | 'next' | 'previous' | 'initiative')` and `encounter()`. The server checks each one exactly as if the viewer had done it, so a player's frame cannot run combat. Each returns a promise that rejects with the reason when the action is refused. A frame may take 10 actions in any 10 seconds; the app refuses more.
- **`useTranslate()`** works in overlays and panels too, with the module's lang files.
- **`useSystemDice()`** returns the table system's custom dice by name, such as `dF`: each with its translated `label` and its `faces`, in order, as `{ label, value }`. It is empty until the system loads, and for systems without custom dice; the frame redraws when they arrive. A roll's results name their die (see [die names](#custom-dice)), so a module can draw a `dF` with its own faces.

A frame that throws is replaced: a panel shows a notice, and an overlay disappears.

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

- **Imports.** Client code may import `react`, `react/jsx-runtime` and `@vtt/sdk/client`; the app provides them, so they are not bundled. Anything else you import, `@vtt/sdk` included, is bundled into the `.js` files by `vtt-plugin pack`. The server only loads the packed `.js`, so a plugin with code must be packed before an instance can run it.
- **A frame per component.** Each custom node and each card renders in a sandboxed frame of its own, with its own React. It reaches the sheet only through the hooks: it cannot read the page around it, the viewer's cookies or storage, or call the API or any other server. A field you `set` goes to the app, which checks it like the viewer's own edit.
- **Size.** The frame takes the height of what you render, up to 4000 px, and the full width of the node's place in the layout.
- **Styles.** The app's styles and your plugin's stylesheets apply inside the frame, under your plugin's scope, as on the sheet. Images and fonts can only come from `data:` URLs: the frame loads nothing from a server, your plugin's files included.
- **Errors.** A component that throws shows a notice in its place; the rest of the sheet keeps working.
- **Trust.** Code still runs in every player's browser and can show them anything, and it can change the fields they may change. That is why admins must acknowledge code when they enable a plugin, and why a replaced plugin with code starts disabled again.
- **Types.** The SDK is not published. To get type checking for plugin code, keep the plugin in this repository's `plugins/` folder, as `tiny-d20` does.

#### Dependencies

`vtt-plugin pack` bundles each entry (`code/client`, `code/shared`, `code/server`) with what it imports into one `code/<entry>.js`. It resolves imports from the plugin folder, as Node does: from a `node_modules` folder in `code/`, in the plugin folder, or in any folder above it. To use a package from npm, give `code/` its own `package.json` and install there:

```json
{
  "name": "my-dice-module-code",
  "private": true,
  "type": "module",
  "dependencies": { "three": "^0.170.0" },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

```sh
cd my-module/code && npm install && cd ../.. && vtt-plugin pack my-module
```

What `pack` leaves out of the archive: every other file under `code/` that ends in `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` or `.json` (your sources, tests, `package.json` and `tsconfig.json`, which are bundled or not needed), any `node_modules` folder, dot files, and earlier `.vttplugin` archives. The validator accepts those files in the folder.

`pack` prints the size of each bundle and warns about one over 1 MiB. Every frame loads the whole `code/client.js` (a module with an overlay and a panel loads it twice), so keep dependencies to what the code needs.

#### Shared code

`code/shared.ts` adds functions that formulas call like the [built-ins](#functions), in derived values, rolls and `visibleIf`:

```ts
import { defineShared } from '@vtt/sdk';

export default defineShared({
  functions: {
    carryCapacity: (str) => (typeof str === 'number' ? str * 15 : 0),
  },
});
```

A function gets the formula's values (numbers, text, booleans or lists) and returns a number, text or boolean. It runs in two places: in each viewer's browser for sheets, and on the server for rolls. Keep it pure, so both get the same answer, and quick: one that takes longer than 100 ms fails the formula. A function that throws fails the formula with an error naming it. Shared code cannot import `react` or the client SDK. In the browser and on the server it runs in the same engine as [server code](#server-code) (QuickJS), with the same isolation and memory limit, and a call that takes longer than 100 ms fails there too.

#### Server code

`code/server.ts` holds the handlers of `handler` recipes. A handler runs on the server when someone rolls the recipe, acting as that person:

```ts
import { defineServer } from '@vtt/sdk';

export default defineServer({
  handlers: {
    attack: async ({ ctx, actor, args }) => {
      const hit = await ctx.roll('1d20 + @derived.strMod');
      await ctx.chat.post({ text: `${actor.name} attacks`, rolls: [hit] });
    },
  },
});
```

It gets:

| Input     | Holds                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `actor`   | The rolling actor: `id`, `name`, `type` and `data`                                                                  |
| `derived` | The actor's derived values, as `@derived` reads them                                                                |
| `totals`  | The actor's item totals, as `@items` reads them                                                                     |
| `items`   | The items the actor holds: `id`, `name`, `type`, `data` and `derived` each                                          |
| `item`    | The item the roll is made with, when the recipe lists item types in `item`                                          |
| `args`    | The button's `args`                                                                                                 |
| `options` | The [roll options](#roll-options), for `then`; empty for a handler recipe                                           |
| `result`  | For `then`: the posted roll, with `total`, `outcome` (the label of the outcome that matched, or `null`) and `rolls` |
| `ctx`     | What the code can do, below                                                                                         |

Everything comes as the roller may see it: players' code never gets secret fields, and derived values and totals are worked out without them.

| `ctx`                            | Does                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `roll(formula)`                  | Rolls against the actor, as a typed roll would, with the plugin's functions, dice and `@args`                                          |
| `chat.post({ text, rolls })`     | Posts a message as the roll's speaker, to its audience. `rolls` must come from `ctx.roll` in the same handler. At most 10 per handler  |
| `actors.get(id)`                 | An actor of the table, as the roller may see it, or `null`                                                                             |
| `actors.adjust(id, path, delta)` | Adds `delta` to a counter (`x-counter`) of an actor the roller owns, within its bounds, formulas included, and returns the new value   |
| `actors.set(id, path, value)`    | Sets a text, number or true/false field that is not a counter, of an actor the roller owns. A value that does not fit the field throws |
| `items.adjust(id, path, delta)`  | Adds `delta` to a counter of an item the roller may edit: one held by an actor they own, or a library item for GMs and assistants      |
| `log(message, data?)`            | Writes to the server log                                                                                                               |
| `fail(message)`                  | Stops the code and shows `message` to the person who rolled, for instance to say what is missing                                       |

A `path` is the field's names joined by dots, `hp.value`; a field in a collection row names the row by its id, `features.<id>.uses`. Only GMs and assistants reach secret fields.

Rules:

- **Post something.** A handler must post at least one message; the first answers the roll. One that posts nothing fails.
- **Time.** A handler may take 5 seconds in all. One that takes longer is stopped, and the roll fails.
- **Errors.** A handler that throws fails its roll. Players see only that the plugin code failed; the error is in the server log. Use `ctx.fail` for a message players should read.
- **Isolation.** Each plugin's shared and server code runs in a JavaScript engine of its own (QuickJS) inside a worker thread. It has the language and its built-ins (`Math`, `JSON`, `Date`, promises…) and `console`, which writes to the server log. It has no Node APIs: no `require` or `import`, `process`, files, network or timers. What it imports must be bundled, as `vtt-plugin pack` does. Values pass in and out as JSON. A crash or a loop stops that worker, never the server; the next roll starts a new one.
- **Memory.** The engine may use 32 MB. Code that needs more fails, and the plugin keeps working.

#### What a roll does next

A formula recipe's `then` names a handler that runs after its roll is posted. The roll keeps its card, outcomes and options, and the code changes what the roll spent:

```json
"cast": {
  "formula": "(@options.slot)d4",
  "options": { "slot": { "type": "number", "label": "option.slot", "default": "@item.level", "minimum": "@item.level", "maximum": 9 } },
  "item": ["spell"],
  "card": "spell",
  "then": "spendSlot"
}
```

```ts
spendSlot: async ({ ctx, actor, options }) => {
  const level = String(options.slot);
  // The counter's maximum is a formula, the slots the character has, so it stops there.
  const used = await ctx.actors.adjust(actor.id, `slotsUsed.l${level}`, 1);
  await ctx.chat.post({ text: `${actor.name} has spent ${String(used)} level ${level} slots.` });
},
```

- It gets the same input as a handler, with `options` (those asked for, the others at their defaults) and `result`.
- It may post nothing. What it posts follows the roll in chat.
- The roll is posted first and stays posted. If the code fails, players see nothing more; if it calls `ctx.fail`, its message is posted as text after the roll. A system's code without the handler leaves the roll alone and logs a warning.

#### Slash commands

`code/server` can also add chat commands. Players type `/name` and some text; the server runs the command with the table's system:

```ts
export default defineServer({
  commands: {
    check: async ({ ctx, actor, args }) => {
      const ability = args.trim().toLowerCase();
      if (ability !== 'str' && ability !== 'dex') return ctx.fail('Use /check str or /check dex.');
      if (!actor) return ctx.fail('Speak as a character to use /check.');
      const roll = await ctx.roll(`1d20 + @derived.${ability}Mod`);
      await ctx.chat.post({ text: `${actor.name} checks ${ability}`, rolls: [roll] });
    },
  },
});
```

A command gets `ctx`, the `actor` the player speaks as (or `null`), and `args`, the text after its name. It follows the rules of handlers, and posts to the audience chosen in the chat. `ctx.roll` rolls against the speaking actor, or with no data when there is none.

Names are lower-case letters, digits, `-` and `_`, starting with a letter. `/r` and `/gmr` are the chat's own and cannot be replaced. A command the system does not have answers "Unknown command", as any other does. This is how `tiny-d20`'s `/check` works.

#### Combat hooks

Two hooks take part in combat:

```ts
export default defineServer({
  hooks: {
    onTurnStart: async ({ ctx, combatant, round }) => {
      if (combatant.actor) await ctx.actors.adjust(combatant.actor.id, 'hp', 1);
      await ctx.chat.post({ text: `${combatant.name} starts turn ${round}` });
    },
    orderCombatants: ({ combatants }) =>
      [...combatants].sort((a, b) => (b.initiative ?? -1) - (a.initiative ?? -1)).map((c) => c.id),
  },
});
```

- **`onTurnStart`** runs when the turn passes to a combatant: when the encounter begins and on each "next turn", not when the GM steps back. It acts as the GM, speaking as the combatant's actor, so `ctx.roll` reads that actor (`actor` is passed too). What it posts reaches only the GM and assistants when the combatant is hidden.
- **`orderCombatants`** runs after every change to the encounter and returns every combatant's id once, in turn order. It replaces [`combat.json`'s `order`](#combat). Any other answer is ignored, with a warning in the server log.

Each combatant has `id`, `name`, `initiative` (or `null`), `hidden`, `side` (`player` or `gm`), `sort` (adding order) and `actor` (`id`, `name`, `type`, `data`, or `null` for a free-form one). Hooks follow the rules of handlers, except that they need not post. A hook that fails is logged, and combat goes on without it.

#### Migrate hook

For changes the [migration steps](#data-migrations) cannot express, `migrate` returns an entity's new data:

```ts
export default defineServer({
  hooks: {
    migrate: ({ kind, type, from, to, data }) =>
      kind === 'actor' && type === 'character' && typeof data.hp === 'number'
        ? { ...data, hp: { value: data.hp, max: data.hp } }
        : data,
  },
});
```

It runs once per entity an upgrade migrates, after the steps, with the version the entity was made with (`from`), the table's new one (`to`) and the data the steps left, both layers together. Collections are maps of rows keyed by id, each with a `sort`. It has no `ctx`: it only computes. Return the data unchanged for entities it has nothing to do with. An error, or an answer that is not an object, fails that entity like a failing step.

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
- migration files: their versions, and each step's type, path and value;
- `coreApi`, `hasCode`, CSS, and lang keys.

### Preview

`vtt-plugin dev <dir> [--port <n>]` renders each type's sheet with its defaults, in memory. Pick the type to show, switch on **Read-only** to see what observers see, or **GM view** to show the secret layer, roll recipes, and edit freely; nothing is saved. Formulas call your `code/shared` functions. `handler` recipes need a server, so they fail in the preview. Every saved file reloads the page.

### Packing

`vtt-plugin pack <dir> [--out <file>]` validates the plugin, compiles `code/` to ES modules (see [Dependencies](#dependencies)), minifies the styles, validates the packed files again, and writes `<id>-<version>.vttplugin` (a ZIP). It prints each bundle's size, and warns about one over 1 MiB. Archives are limited to 20 MB, 2,000 files and 50 MB unpacked.

### Installing and updating

Admins install a plugin in either of two ways:

- **Upload:** on the **Plugins** page, **Install plugin** takes a `.vttplugin`. Installing a plugin whose id is already installed asks before replacing it.
- **Folder:** copy the plugin folder into `DATA_DIR/plugins/<id>/` and press **Rescan**.

New plugins start disabled until an admin enables them. Disabling a plugin makes the tables that use it read-only until it is enabled again.

To update a plugin, raise `version` and install it again. Tables, actors and their data stay: each table keeps playing its version until a GM upgrades it in the table settings, which runs the plugin's [data migrations](#data-migrations). Fields an entity lacks start at their defaults.
