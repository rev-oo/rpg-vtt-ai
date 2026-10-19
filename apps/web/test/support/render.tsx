import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { App } from '../../src/shell/App.js';
import { useSession } from '../../src/shell/session-store.js';

import { LocationProbe } from './LocationProbe.js';

const initialSession = useSession.getState();

export function renderApp(path = '/'): RenderResult {
  useSession.setState(initialSession, true);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}
