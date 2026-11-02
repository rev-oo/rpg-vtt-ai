import { describe, expect, it } from 'vitest';

import {
  entryPanelId,
  itemPanelId,
  PAGE_PANELS,
  sheetPanelId,
  TOOL_PANELS,
} from '../src/features/workspace/panel-ids.js';
import { panelIcon } from '../src/icons.js';

describe('panel icons (ADR-071)', () => {
  it('gives every tool, page and document panel an icon', () => {
    for (const id of [...TOOL_PANELS, ...PAGE_PANELS]) expect(panelIcon(id), id).toBeDefined();
    for (const id of [sheetPanelId('a'), itemPanelId('i'), entryPanelId('e')]) {
      expect(panelIcon(id), id).toBeDefined();
    }
    expect(panelIcon('toString')).toBeUndefined();
    expect(panelIcon('elsewhere')).toBeUndefined();
  });
});
