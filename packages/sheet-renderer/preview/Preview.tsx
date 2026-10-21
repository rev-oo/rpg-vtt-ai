import { useMemo, useState, type ReactElement } from 'react';

import { seededRng, type Value } from '@vtt/formula';
import { chatCardView, createRules, type RecipeResult } from '@vtt/plugin-engine';
import { describePluginIssue } from '@vtt/plugin-schema';
import { Alert, Card, Select } from '@vtt/ui';

import { createMemoryStore, Sheet } from '../src/index.js';

import { loadPreviewPlugin, PREVIEW_PLUGINS } from './plugins.js';

interface Choice {
  kind: 'actor' | 'item';
  type: string;
}

/**
 * Renders a reference plugin's sheets against an in-memory store (T-0408), with the plugin's
 * English texts and scoped CSS. Rolls run in the browser with the plugin engine.
 */
export function Preview(): ReactElement {
  const [pluginId, setPluginId] = useState(
    PREVIEW_PLUGINS.includes('tiny-d20') ? 'tiny-d20' : (PREVIEW_PLUGINS[0] ?? ''),
  );
  const loaded = useMemo(() => loadPreviewPlugin(pluginId), [pluginId]);
  const plugin = loaded.plugin;
  const choices: Choice[] = plugin
    ? [
        ...Object.keys(plugin.actorTypes).map((type) => ({ kind: 'actor' as const, type })),
        ...Object.keys(plugin.itemTypes).map((type) => ({ kind: 'item' as const, type })),
      ]
    : [];
  const [choiceKey, setChoiceKey] = useState('');
  const choice = choices.find((entry) => `${entry.kind}:${entry.type}` === choiceKey) ?? choices[0];
  const [readOnly, setReadOnly] = useState(false);
  const [secret, setSecret] = useState(true);
  const [rolls, setRolls] = useState<RecipeResult[]>([]);

  const rules = useMemo(() => (plugin ? createRules(plugin) : undefined), [plugin]);
  const type =
    plugin && choice
      ? (choice.kind === 'actor' ? plugin.actorTypes : plugin.itemTypes)[choice.type]
      : undefined;
  const selected = choice ? `${choice.kind}:${choice.type}` : '';
  // A fresh store, with the type's defaults, whenever another type is picked.
  const store = useMemo(() => {
    const [kind, name] = selected.split(':');
    if (!rules || (kind !== 'actor' && kind !== 'item') || !name) return undefined;
    return createMemoryStore(rules.defaults(kind, name));
  }, [rules, selected]);
  const lang = plugin?.lang.en ?? {};
  const translate = (text: string): string =>
    Object.hasOwn(lang, text) ? (lang[text] ?? text) : text;

  const roll = (name: string, args: Readonly<Record<string, Value>>) => {
    if (!rules || !choice || !store) return;
    try {
      const result = rules.roll(name, {
        kind: choice.kind,
        type: choice.type,
        data: store.getSnapshot(),
        args,
        rng: seededRng(Date.now()),
      });
      setRolls((previous) => [result, ...previous].slice(0, 10));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <style>{loaded.css}</style>
      <h1 className="text-2xl font-bold">Sheet preview</h1>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Plugin"
          value={pluginId}
          onChange={(event) => {
            setPluginId(event.target.value);
            setChoiceKey('');
            setRolls([]);
          }}
        >
          {PREVIEW_PLUGINS.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </Select>
        <Select
          label="Type"
          value={choice ? `${choice.kind}:${choice.type}` : ''}
          onChange={(event) => {
            setChoiceKey(event.target.value);
          }}
        >
          {choices.map((entry) => (
            <option key={`${entry.kind}:${entry.type}`} value={`${entry.kind}:${entry.type}`}>
              {entry.kind} · {entry.type}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => {
              setReadOnly(event.target.checked);
            }}
          />{' '}
          Read-only
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={secret}
            onChange={(event) => {
              setSecret(event.target.checked);
            }}
          />{' '}
          GM view
        </label>
      </div>

      {loaded.issues.length > 0 && (
        <Alert tone={plugin ? 'info' : 'error'}>
          <ul className="list-disc pl-5">
            {loaded.issues.map((issue, index) => (
              <li key={index}>{describePluginIssue(issue)}</li>
            ))}
          </ul>
        </Alert>
      )}

      {plugin && rules && type && store && choice && (
        <Card>
          <Sheet
            key={`${pluginId}:${choice.kind}:${choice.type}`}
            pluginId={pluginId}
            layout={
              plugin.sheets[type.sheet]?.layout ?? {
                type: 'text',
                text: `Missing sheet ${type.sheet}`,
              }
            }
            type={type}
            store={store}
            settings={rules.settings}
            readOnly={readOnly}
            secret={secret}
            translate={translate}
            onRoll={roll}
          />
        </Card>
      )}

      {rolls.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Rolls</h2>
          <ul className="flex flex-col gap-1">
            {rolls.map((result, index) => {
              const view = chatCardView(result, { hasTemplate: () => false, translate });
              return <li key={index}>{view.kind === 'text' ? view.text : view.card.title}</li>;
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
