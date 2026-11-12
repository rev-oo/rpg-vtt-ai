import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../src/api/client.js';

import { fakeApi, UNAUTHENTICATED } from './support/fake-api.js';
import { renderApp } from './support/render.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const TOKEN = 'a'.repeat(43);

describe('pages outside the table (T-1620)', () => {
  it('says when an address leads nowhere, with the way back', async () => {
    fakeApi({ 'GET /setup/status': { body: { needsSetup: false } }, 'GET /me': UNAUTHENTICATED });
    renderApp('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your tables' })).toHaveAttribute('href', '/');
  });

  it('names the table and its GM to a visitor who must sign in first', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': UNAUTHENTICATED,
      'GET /instance': { body: { instance: { siteName: 'VTT', registration: 'closed' } } },
      [`GET /invites/${TOKEN}`]: {
        body: {
          invite: { role: 'player', table: { id: 't1', name: 'Goblin King', gm: 'Mara' } },
        },
      },
    });
    renderApp(`/invite/${TOKEN}`);
    expect(
      await screen.findByText('You are invited to join Goblin King, run by Mara, as Player.'),
    ).toBeInTheDocument();
    // Sign in reads as the page's action, not as running text.
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveClass('bg-primary');
    expect(signIn.getAttribute('href')).toContain(`/login?next=`);
  });
});
