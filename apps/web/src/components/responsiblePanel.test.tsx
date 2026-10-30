import type { CurrentUser, TicketDetail } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ResponsiblePanel } from './ResponsiblePanel';

vi.mock('../api', () => ({ api: vi.fn() }));

function signedInAs(roles: string[]) {
  const me = {
    id: 'u1',
    username: 'x',
    fullName: 'Helena Mondlane',
    roles,
    teamId: 't1',
    teamName: 'South 1',
    onDuty: false
  };
  vi.mocked(api).mockImplementation(((path: string) =>
    Promise.resolve(path === '/me' ? (me as CurrentUser) : [])) as never);
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ticket = (over: Partial<TicketDetail>) =>
  ({
    id: 'k1',
    status: 'accepted',
    teamId: 't1',
    teamName: 'South 1',
    assignee: { id: 's1', fullName: 'Ana Sitoe' },
    incident: null,
    offer: null,
    allowedActions: ['assign', 'cancel'],
    ...over
  }) as TicketDetail;

describe('ResponsiblePanel', () => {
  it('shows the team and the person together, and lets a manager take the job back with a reason', async () => {
    const wrapper = signedInAs(['team_manager']);
    render(<ResponsiblePanel t={ticket({})} onChange={vi.fn()} />, { wrapper });
    expect(screen.getByText('Team South 1')).toBeInTheDocument();
    expect(screen.getByText('Accepted, on the way')).toBeInTheDocument();
    expect(screen.getByText('Ana Sitoe')).toBeInTheDocument();
    // Moving to another team is for NOC, technical managers and administrators.
    expect(screen.queryByRole('button', { name: 'Move to another team' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change person' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Take the job back' }));
    const confirm = screen.getByRole('button', { name: 'Take the job back' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why the job is taken back'), 'Ana is sick');
    expect(confirm).toBeEnabled();
  });

  it('says the ticket waits when nobody is left in the team', () => {
    const wrapper = signedInAs(['noc']);
    render(
      <ResponsiblePanel
        t={ticket({ status: 'new', assignee: null, allowedActions: ['cancel'] })}
        onChange={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText('Nobody yet')).toBeInTheDocument();
    expect(screen.getByText('Nobody on it yet')).toBeInTheDocument();
    expect(screen.getByText(/Nobody is left in team South 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take the job back' })).not.toBeInTheDocument();
  });

  it('shows who was told while nobody has claimed the job, and lets a manager tell the team again', async () => {
    const wrapper = signedInAs(['team_manager']);
    const onChange = vi.fn();
    render(
      <ResponsiblePanel
        t={ticket({
          status: 'new',
          assignee: null,
          offer: {
            teamName: 'South 1',
            notified: ['Ana Sitoe', 'Armando Cossa'],
            round: 2,
            at: '2026-10-30T12:15:00Z'
          }
        })}
        onChange={onChange}
      />,
      { wrapper }
    );
    expect(screen.getByText('Waiting for someone to claim it')).toBeInTheDocument();
    expect(screen.getByText('Told 2 people of team South 1')).toBeInTheDocument();
    expect(screen.getByText('Told again (time 2) at 14:15 · nobody has claimed it yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a person' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Tell the team again' }));
    expect(api).toHaveBeenCalledWith('/tickets/k1/offer', { method: 'POST' });
  });
});
