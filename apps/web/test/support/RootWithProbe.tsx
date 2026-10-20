import type { ReactElement } from 'react';
import { Outlet, useLocation } from 'react-router';

function LocationProbe(): ReactElement {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

/** The root route's outlet plus the current location, for assertions on redirects. */
export function RootWithProbe(): ReactElement {
  return (
    <>
      <Outlet />
      <LocationProbe />
    </>
  );
}
