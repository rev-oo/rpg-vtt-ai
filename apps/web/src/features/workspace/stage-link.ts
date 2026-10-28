import { useLocation } from 'react-router';

/**
 * Builds links into the workspace stage that keep the browse panel's tab and filters
 * (`?panel=…&q=…`), so the list beside the stage stays as it was (ADR-059).
 */
export function useStageLink(): (path: string) => string {
  const { search } = useLocation();
  return (path) => `${path}${search}`;
}
