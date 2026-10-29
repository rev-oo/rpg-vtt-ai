import {
  ActorsPanel,
  ChatDockPanel,
  CompendiumPanel,
  CombatPanel,
  DicePanel,
  EntryPanel,
  ItemPanel,
  ItemsPanel,
  JournalPanel,
  MembersDockPanel,
  OverviewPanel,
  SettingsPanel,
  SheetPanel,
} from './panels.js';

/** Dockview's components, by the `component` name each panel is saved with (ADR-059). */
export const PANEL_COMPONENTS = {
  actors: ActorsPanel,
  items: ItemsPanel,
  journal: JournalPanel,
  compendium: CompendiumPanel,
  sheet: SheetPanel,
  entry: EntryPanel,
  item: ItemPanel,
  overview: OverviewPanel,
  members: MembersDockPanel,
  settings: SettingsPanel,
  combat: CombatPanel,
  chat: ChatDockPanel,
  dice: DicePanel,
};
