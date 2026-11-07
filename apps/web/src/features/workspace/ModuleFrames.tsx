import type { IDockviewPanelProps } from 'dockview-react';
import { useMemo, type ReactElement } from 'react';

import type { Viewer } from '@vtt/sdk/client';

import { t } from '../../i18n/index.js';
import type { ActionContext } from '../../plugin-host/module-actions.js';
import { ModuleFrame } from '../../plugin-host/ModuleFrame.js';
import {
  useFramedModules,
  useLoadedModules,
  type FramedModule,
} from '../../plugin-host/table-modules.js';
import { useTableData } from '../table/table-data.js';

import { useDock } from './dock-context.js';

// Module overlays and panels in the table workspace (T-1603, ADR-077).

/** What a module frame acts with: the viewer's page, through the dock. */
function useActionContext(moduleId: string): { viewer: Viewer; context: ActionContext } {
  const data = useTableData();
  const dock = useDock();
  const { reload } = useLoadedModules();
  const { table, actors } = data;
  return useMemo(
    () => ({
      viewer: { id: dock.userId, role: table.role },
      context: {
        tableId: table.id,
        moduleId,
        actorIds: () => actors.map((actor) => actor.id),
        open: dock.open,
        reload,
      },
    }),
    [dock, table.id, table.role, actors, moduleId, reload],
  );
}

/** A module's panel in the dock; its params name the module and panel. */
export function ModulePanel({ params }: IDockviewPanelProps): ReactElement {
  const { moduleId, name } = params as { moduleId: string; name: string };
  const module = useFramedModules().find((each) => each.id === moduleId);
  const panel = module?.frames.panels.find((each) => each.name === name);
  const { viewer, context } = useActionContext(moduleId);
  if (!module || !panel) {
    return <p className="p-3 text-sm text-muted">{t('module.panelGone')}</p>;
  }
  return (
    <ModuleFrame
      module={module}
      kind="panel"
      name={name}
      title={module.translate(panel.title)}
      viewer={viewer}
      context={context}
      className="block h-full w-full border-0 bg-transparent"
    />
  );
}

function Overlay({
  module,
  name,
  interactive,
}: {
  module: FramedModule;
  name: string;
  interactive: boolean;
}): ReactElement {
  const { viewer, context } = useActionContext(module.id);
  return (
    <ModuleFrame
      module={module}
      kind="overlay"
      name={name}
      title={`${module.name}: ${name}`}
      viewer={viewer}
      context={context}
      className={`absolute inset-0 h-full w-full border-0 bg-transparent ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
    />
  );
}

/** Every overlay of the table's modules, over the workspace; clicks pass through the layer. */
export function ModuleOverlays({ shown }: { shown: boolean }): ReactElement | null {
  const modules = useFramedModules();
  const overlays = modules.flatMap((module) =>
    module.frames.overlays.map((overlay) => ({ module, ...overlay })),
  );
  if (!shown || overlays.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {overlays.map(({ module, name, interactive }) => (
        <Overlay
          key={`${module.id}:${name}`}
          module={module}
          name={name}
          interactive={interactive}
        />
      ))}
    </div>
  );
}
