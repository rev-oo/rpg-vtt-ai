import { useRouteLoaderData } from 'react-router';

/** What `routes/signed-in.tsx` loads for every signed-in page. */
export interface SignedInData {
  siteName: string;
}

/** The id React Router gives `routes/signed-in.tsx`. */
export const SIGNED_IN_ROUTE_ID = 'routes/signed-in';

/** The instance's name, for pages below the signed-in area. */
export function useSiteName(): string {
  return useRouteLoaderData<SignedInData>(SIGNED_IN_ROUTE_ID)?.siteName ?? '';
}
