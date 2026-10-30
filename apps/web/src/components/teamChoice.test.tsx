import type { CurrentUser, Lookups } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { teamChangeText } from '../format';
import { TeamChoice, type TeamPick } from './TeamChoice';

vi.mock('../api', () => ({ api: vi.fn() }));

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

function signedInAs(roles: string[]) {
  const me = {
    id: 'u1',
    username: 'x',
    fullName: 'Nádia Mussa',
    roles,
    teamId: null,
    teamName: null,
    onDuty: false
  };
  vi.mocked(api).mockImplementation(((path: string) =>
    Promise.resolve(path === '/me' ? (me as CurrentUser) : lookups)) as never);
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('TeamChoice', () => {
  it('shows the team of the place, and lets NOC choose another team with a reason', async () => {
    const wrapper = signedInAs(['noc']);
    const onChange = vi.fn<(v: TeamPick | null) => void>();
    const { rerender } = render(<TeamChoice autoTeamName="South 1" value={null} onChange={onChange} />, {
      wrapper
    });
    expect(screen.getByText('South 1')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose another team' }));
    expect(onChange).toHaveBeenLastCalledWith({ teamId: '', reason: '' });

    rerender(<TeamChoice autoTeamName="South 1" value={{ teamId: '', reason: '' }} onChange={onChange} />);
    await screen.findByRole('option', { name: 'South 2 · Maputo Central' });
    await userEvent.selectOptions(screen.getByLabelText('Team that goes'), 't2');
    expect(onChange).toHaveBeenLastCalledWith({ teamId: 't2', reason: '' });
    // The team of the place is not offered as "another" team.
    expect(screen.queryByRole('option', { name: 'South 1 · Matola' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Why another team goes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use the team of the place' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('does not offer another team to people who may not choose it', async () => {
    const wrapper = signedInAs(['bo_support']);
    render(<TeamChoice autoTeamName="South 1" value={null} onChange={vi.fn()} />, { wrapper });
    await screen.findByText('South 1');
    // Give the role check a moment to settle before asserting absence.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Choose another team' })).not.toBeInTheDocument();
  });
});

describe('history line for a team change', () => {
  it('says which team was chosen instead of the team of the place', () => {
    expect(
      teamChangeText({
        fromName: 'South 1',
        teamName: 'South 2',
        reason: 'South 1 is on the outage',
        atCreation: true
      })
    ).toBe('chose team South 2 instead of South 1 (team of the place)');
  });
  it('says from which team to which a ticket moved, and who no longer has it', () => {
    expect(
      teamChangeText({
        fromName: 'South 1',
        teamName: 'South 2',
        reason: 'Place marked wrongly',
        unassignedName: 'Armando Cossa'
      })
    ).toBe('moved it from team South 1 to team South 2 (taken back from Armando Cossa)');
    // A ticket outside every area, put in a team for the first time.
    expect(teamChangeText({ fromName: null, teamName: 'South 1', reason: null })).toBe(
      'moved it to team South 1'
    );
  });
});
