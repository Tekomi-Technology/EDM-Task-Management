import type { CurrentUser } from './types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { App } from './App';

vi.mock('./api', () => ({ api: vi.fn() }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

/** The app at an address, signed in with these roles; other data never arrives (the pages just wait). */
function renderAt(path: string, roles: string[]) {
  const me: CurrentUser = {
    id: 'u1',
    username: 'someone',
    fullName: 'Ana Silva',
    roles,
    teamId: null,
    teamName: null,
    onDuty: false
  };
  vi.mocked(api).mockImplementation((p: string) =>
    p === '/me' ? Promise.resolve(me) : new Promise(() => undefined)
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const ADMIN_LINKS = ['/admin/users', '/admin/areas', '/admin/api-keys', '/admin/security', '/admin/api-docs'];
// Plain selectors: role queries over the whole app are slow in jsdom.
const nav = (name: string) => document.querySelector<HTMLElement>(`nav[aria-label="${name}"]`);
const findNav = (name: string) =>
  waitFor(
    () => {
      const el = nav(name);
      if (!el) throw new Error(`no ${name} menu`);
      return el;
      // Without printing the page on failure, which hangs on this app.
    },
    { onTimeout: (e) => e }
  );
const linksIn = (el: HTMLElement) => [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('the admin area', () => {
  it('has its own menu with the five admin pages and no way to the operations pages', async () => {
    renderAt('/admin', ['admin']);
    const menu = await findNav('Administration');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/users'));
    expect(linksIn(menu)).toEqual(['/admin/users', ...ADMIN_LINKS]);
    expect(nav('Main')).toBeNull();
  });

  it('is closed to everyone but administrators, technical managers included', async () => {
    renderAt('/admin/api-docs', ['technical_manager']);
    expect(await screen.findByText('Only administrators can open this page.')).toBeInTheDocument();
    expect(nav('Administration')).toBeNull();
  });

  it('is not linked from the operations pages, even for administrators', async () => {
    renderAt('/', ['admin']);
    const menu = await findNav('Main');
    // Once the person is known, the menu has everything an administrator sees.
    await waitFor(() => expect(linksIn(menu)).toContain('/reports'), { onTimeout: (e) => e });
    expect(linksIn(menu).filter((href) => href?.startsWith('/admin'))).toEqual([]);
    expect(menu).not.toHaveTextContent('Settings');
  });

  it('takes the old addresses of the admin pages to the admin area', async () => {
    renderAt('/api-keys', ['admin']);
    await findNav('Administration');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/api-keys'));
  });
});
