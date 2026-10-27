import { useEffect, useMemo, useState, type ComponentType, type ReactElement } from 'react';

import { seededRng, type FormulaFunction, type Value } from '@vtt/formula';
import { chatCardView, createRules, type RecipeResult } from '@vtt/plugin-engine';
import { describePluginIssue, type PluginDefinition, type PluginIssue } from '@vtt/plugin-schema';
import type { CardProps, ClientDefinition } from '@vtt/sdk/client';
import { createMemoryStore, Sheet, type CustomNodeProps } from '@vtt/sheet-renderer';
import { Alert, Card, Select } from '@vtt/ui';

import { bridge } from './bridge.js';

export interface DevPlugin {
  id: string;
  definition: PluginDefinition | null;
  issues: PluginIssue[];
  css: string;
  client: string | null;
  shared: string | null;
}

interface Choice {
  kind: 'actor' | 'item';
  type: string;
}

const isClient = (value: unknown): value is { default: ClientDefinition } =>
  typeof value === 'object' && value !== null && 'default' in value;

/** Loads `code/client.*` through the dev server, like the app does in production. */
function useClient(url: string | null): { client: ClientDefinition | null; error: string | null } {
  const [state, setState] = useState<{ client: ClientDefinition | null; error: string | null }>({
    client: null,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    let current = true;
    import(/* @vite-ignore */ url).then(
      (loaded: unknown) => {
        if (!current) return;
        setState(
          isClient(loaded)
            ? { client: loaded.default, error: null }
            : { client: null, error: 'code/client must export defineClient({ … }) by default' },
        );
      },
      (error: unknown) => {
        if (current) setState({ client: null, error: String(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [url]);
  return state;
}

type Functions = Readonly<Record<string, FormulaFunction>>;

/** The functions of `code/shared.*`, whose default export is `defineShared({ functions })`. */
function sharedFunctions(loaded: unknown): Functions | null {
  if (typeof loaded !== 'object' || loaded === null || !('default' in loaded)) return null;
  const definition: unknown = loaded.default;
  if (typeof definition !== 'object' || definition === null) return null;
  const functions: unknown = 'functions' in definition ? definition.functions : {};
  if (typeof functions !== 'object' || functions === null) return null;
  const entries: [string, unknown][] = Object.entries(functions);
  const callable = entries.filter((entry): entry is [string, FormulaFunction] => {
    return typeof entry[1] === 'function';
  });
  return callable.length === entries.length ? Object.fromEntries(callable) : null;
}

/** Loads `code/shared.*` through the dev server, so formulas can call its functions. */
function useShared(url: string | null): { functions: Functions; error: string | null } {
  const [state, setState] = useState<{ functions: Functions; error: string | null }>({
    functions: {},
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    let current = true;
    import(/* @vite-ignore */ url).then(
      (loaded: unknown) => {
        if (!current) return;
        const functions = sharedFunctions(loaded);
        setState(
          functions
            ? { functions, error: null }
            : { functions: {}, error: 'code/shared must export defineShared({ … }) by default' },
        );
      },
      (error: unknown) => {
        if (current) setState({ functions: {}, error: String(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [url]);
  return state;
}

/**
 * One plugin's sheets against an in-memory store (`vtt-plugin dev`, §8.13), with its English
 * texts, scoped CSS, client code and shared functions. Rolls run in the browser with the
 * plugin engine; `handler` recipes need the server, so they fail here.
 */
export function DevPreview({ plugin }: { plugin: DevPlugin }): ReactElement {
  const { definition } = plugin;
  const { client, error: clientError } = useClient(plugin.client);
  const { functions, error: sharedError } = useShared(plugin.shared);
  const choices: Choice[] = definition
    ? [
        ...Object.keys(definition.actorTypes).map((type) => ({ kind: 'actor' as const, type })),
        ...Object.keys(definition.itemTypes).map((type) => ({ kind: 'item' as const, type })),
      ]
    : [];
  const [choiceKey, setChoiceKey] = useState('');
  const choice = choices.find((entry) => `${entry.kind}:${entry.type}` === choiceKey) ?? choices[0];
  const [readOnly, setReadOnly] = useState(false);
  const [secret, setSecret] = useState(true);
  const [rolls, setRolls] = useState<RecipeResult[]>([]);

  const rules = useMemo(
    () => (definition ? createRules(definition, { functions }) : undefined),
    [definition, functions],
  );
  const selected = choice ? `${choice.kind}:${choice.type}` : '';
  const store = useMemo(() => {
    const [kind, name] = selected.split(':');
    if (!rules || (kind !== 'actor' && kind !== 'item') || !name) return undefined;
    return createMemoryStore(rules.defaults(kind, name));
  }, [rules, selected]);
  const translate = useMemo(() => {
    const lang = definition?.lang[definition.manifest.defaultLocale ?? 'en'] ?? {};
    return (text: string): string => (Object.hasOwn(lang, text) ? (lang[text] ?? text) : text);
  }, [definition]);
  const nodes = useMemo(() => {
    const actor = { id: 'preview', name: 'Preview', type: choice?.type ?? '' };
    return Object.fromEntries(
      Object.entries(client?.nodes ?? {}).map(
        ([name, node]): [string, ComponentType<CustomNodeProps>] => [
          name,
          bridge(node, actor, translate),
        ],
      ),
    );
  }, [client, choice?.type, translate]);

  const type =
    definition && choice
      ? (choice.kind === 'actor' ? definition.actorTypes : definition.itemTypes)[choice.type]
      : undefined;

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
      <style>{plugin.css}</style>
      <h1 className="text-2xl font-bold">
        {definition ? `${definition.manifest.name} ${definition.manifest.version}` : plugin.id}
      </h1>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Type"
          value={selected}
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

      {plugin.issues.length > 0 && (
        <Alert tone={definition ? 'info' : 'error'}>
          <ul className="list-disc pl-5">
            {plugin.issues.map((issue, index) => (
              <li key={index}>
                {issue.severity}: {describePluginIssue(issue)}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {clientError && <Alert tone="error">{clientError}</Alert>}
      {sharedError && <Alert tone="error">{sharedError}</Alert>}

      {definition && rules && type && store && choice && (
        <Card>
          <Sheet
            key={selected}
            pluginId={plugin.id}
            layout={
              definition.sheets[type.sheet]?.layout ?? {
                type: 'text',
                text: `Missing sheet ${type.sheet}`,
              }
            }
            type={type}
            store={store}
            settings={rules.settings}
            functions={functions}
            readOnly={readOnly}
            secret={secret}
            translate={translate}
            nodes={nodes}
            onRoll={roll}
          />
        </Card>
      )}

      {rolls.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Rolls</h2>
          <ul className="flex flex-col gap-2" data-plugin={plugin.id}>
            {rolls.map((result, index) => (
              <li key={index}>
                <RollResultView
                  result={result}
                  client={client}
                  pluginId={plugin.id}
                  translate={translate}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function RollResultView({
  result,
  client,
  pluginId,
  translate,
}: {
  result: RecipeResult;
  client: ClientDefinition | null;
  pluginId: string;
  translate: (text: string) => string;
}): ReactElement {
  const Custom: ComponentType<CardProps> | undefined = result.card
    ? client?.cards?.[result.card.name]
    : undefined;
  const text = chatCardView(result, { hasTemplate: () => false, translate });
  if (!Custom || text.kind !== 'text') return <p>{text.kind === 'text' ? text.text : ''}</p>;
  return (
    <Custom
      card={{
        system: pluginId,
        recipe: result.recipe,
        label: result.label ?? null,
        outcome: result.outcome,
        card: result.card ?? null,
      }}
      rolls={[result.roll]}
      speaker={{ name: 'Preview', actorId: null, imageUrl: null }}
      translate={translate}
    />
  );
}
