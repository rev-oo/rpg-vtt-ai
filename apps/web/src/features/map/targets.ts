import { createContext, use, useMemo, useState } from 'react';

// Targets (T-1615, ADR-082): the tokens a member marks on the map. They stay with the member's
// page, apart from the selected token, which is the one they move. A roll whose recipe targets
// actors sends them, and the first is the recipe's `@target`.

export interface Targets {
  /** The targeted tokens, in the order they were targeted. */
  ids: readonly string[];
  /** Targets a token, or stops targeting it. */
  toggle: (tokenId: string) => void;
  /** Keeps only the targets among `tokenIds`, as when tokens leave the scene. */
  keep: (tokenIds: readonly string[]) => void;
}

const NONE: Targets = { ids: [], toggle: () => undefined, keep: () => undefined };

export const TargetsContext = createContext<Targets>(NONE);

/** The member's targets on the table page; none outside it. */
export function useTargets(): Targets {
  return use(TargetsContext);
}

/** The state behind `TargetsContext`, for the table page. */
export function useTargetState(): Targets {
  const [ids, setIds] = useState<readonly string[]>([]);
  return useMemo(
    () => ({
      ids,
      toggle: (tokenId) => {
        setIds((current) =>
          current.includes(tokenId)
            ? current.filter((id) => id !== tokenId)
            : [...current, tokenId],
        );
      },
      keep: (tokenIds) => {
        setIds((current) => {
          const kept = current.filter((id) => tokenIds.includes(id));
          return kept.length === current.length ? current : kept;
        });
      },
    }),
    [ids],
  );
}
