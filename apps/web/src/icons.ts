import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Circle,
  Cone,
  Copy,
  Dices,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  LogOut,
  Map as MapIcon,
  Maximize,
  MessageSquare,
  Minus,
  MousePointer2,
  Package,
  PanelsTopLeft,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  ScrollText,
  Send,
  Settings,
  Swords,
  Trash2,
  Undo2,
  Upload,
  User,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { createElement, type ReactElement } from 'react';

import { IconSlot } from '@vtt/ui';

import type { PagePanel, ToolPanel } from './features/workspace/panel-ids.js';

// The app's icons (ADR-071): Lucide SVGs under the names the app uses, so they change here.

export const ICON = {
  add: Plus,
  back: ArrowLeft,
  close: X,
  copy: Copy,
  delete: Trash2,
  down: ArrowDown,
  edit: Pencil,
  fit: Maximize,
  hide: EyeOff,
  open: ExternalLink,
  ownership: KeyRound,
  panels: PanelsTopLeft,
  reset: RotateCcw,
  restore: Undo2,
  roll: Dices,
  send: Send,
  show: Eye,
  signOut: LogOut,
  up: ArrowUp,
  upload: Upload,
  zoomIn: Plus,
  zoomOut: Minus,
  // Map tools.
  select: MousePointer2,
  ruler: Ruler,
  circle: Circle,
  cone: Cone,
  reveal: Eye,
} satisfies Record<string, LucideIcon>;

const PANELS: Record<ToolPanel | PagePanel, LucideIcon> = {
  map: MapIcon,
  scenes: Layers,
  actors: Users,
  items: Package,
  journal: BookOpen,
  compendium: Library,
  assets: ImageIcon,
  combat: Swords,
  chat: MessageSquare,
  dice: Dices,
  overview: LayoutDashboard,
  members: UserCog,
  settings: Settings,
};

/** A dock panel's icon: a tool's or page's own, or its document's kind (sheet, item, entry). */
const byId: Partial<Record<string, LucideIcon>> = PANELS;
export function panelIcon(panelId: string): LucideIcon | undefined {
  if (Object.hasOwn(PANELS, panelId)) return byId[panelId];
  if (panelId.startsWith('actor:')) return User;
  if (panelId.startsWith('item:')) return Package;
  if (panelId.startsWith('entry:')) return ScrollText;
  return undefined;
}

/** A dock panel's icon, hidden from screen readers; nothing for a panel without one. */
export function PanelIcon({ panelId }: { panelId: string }): ReactElement | null {
  const icon = panelIcon(panelId);
  return icon ? createElement(IconSlot, null, createElement(icon)) : null;
}
