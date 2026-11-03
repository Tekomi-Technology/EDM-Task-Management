import type { CurrentUser, Lookups } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { PlanForm } from './PlannedWorkPage';

vi.mock('../api', () => ({ api: vi.fn(), ApiRequestError: class extends Error {} }));

const lookups: Lookups = {
  areas: [
    { id: 'a1', name: 'Matola' },
    { id: 'a2', name: 'Maputo Central' }
  ],
  teams: [
    { id: 't1', name: 'South 1', areaId: 'a1', areaName: 'Matola' },
    { id: 't2', name: 'South 2', areaId: 'a2', areaName: 'Maputo Central' }
  ]
};

function signedInAs(roles: string[], teamId: string | null) {
  const me: CurrentUser = {
    id: 'u1',
    username: 'x',
    fullName: 'Helena Mondlane',
    roles: roles as CurrentUser['roles'],
    teamId,
    teamName: teamId ? 'South 1' : null,
    onDuty: false
  } as CurrentUser;
  vi.mocked(api).mockImplementation(((path: string) =>
    Promise.resolve(path === '/me' ? me : lookups)) as never);
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('PlanForm', () => {
  it('shows a team manager only their own team when planning work', async () => {
    render(<PlanForm lookups={lookups} onCreated={vi.fn()} />, {
      wrapper: signedInAs(['team_manager'], 't1')
    });
    const select = await screen.findByLabelText('Team');
    await screen.findByDisplayValue('South 1 · Matola');
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['South 1 · Matola']);
  });

  it('lets an operations supervisor choose any team', async () => {
    render(<PlanForm lookups={lookups} onCreated={vi.fn()} />, {
      wrapper: signedInAs(['technical_manager'], null)
    });
    const select = await screen.findByLabelText('Team');
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Choose a team…', 'South 1 · Matola', 'South 2 · Maputo Central']);
  });
});
