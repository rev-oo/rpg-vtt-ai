import type { ReactElement } from 'react';
import { useLocation } from 'react-router';

/** Shows the current path so tests can assert redirects. */
export function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}
