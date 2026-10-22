import { describe, expect, it } from 'vitest';

import { documentName, parseDocumentName } from '../src/index.js';

const ID = '0b0c8a4e-6c1f-4f3a-9d2e-1a2b3c4d5e6f';

describe('document names (specs §9.1)', () => {
  it('round-trips every kind and layer', () => {
    for (const ref of [
      { kind: 'actor', id: ID, layer: 'main' },
      { kind: 'actor', id: ID, layer: 'secret' },
      { kind: 'journal', id: ID, layer: 'main' },
    ] as const) {
      expect(parseDocumentName(documentName(ref))).toEqual(ref);
    }
  });

  it.each([
    '',
    `actor:${ID}`,
    `actor:${ID}:gm`,
    `journal:${ID}:secret`,
    `item:${ID}:main`,
    `actor:${ID.toUpperCase()}:main`,
    `actor:not-an-id:main`,
    `actor:${ID}:main:extra`,
    ` actor:${ID}:main`,
    `actor:${ID}:main\n`,
  ])('rejects %j', (name) => {
    expect(parseDocumentName(name)).toBeNull();
  });
});
