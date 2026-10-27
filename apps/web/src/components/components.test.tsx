import type { AdminUser, Lookups } from '@edm/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initials, timeCell, timeLeft, waitingFor } from '../format';
import { StatusBadge } from './StatusBadge';
import { UserEditor } from './UserEditor';

describe('StatusBadge', () => {
  it('uses plain words for the status', () => {
    render(<StatusBadge status="resolved" />);
    expect(screen.getByText('Waiting for check')).toBeInTheDocument();
  });
});

describe('time left', () => {
  const now = Date.parse('2026-10-26T09:40:00Z');
  it('shows time left, nearly late and late', () => {
    expect(timeLeft('2026-10-26T11:00:00Z', 'assigned', now)).toEqual({
      text: '1 h 20 min',
      late: false,
      soon: false
    });
    expect(timeLeft('2026-10-26T10:00:00Z', 'new', now)).toEqual({ text: '20 min', late: false, soon: true });
    expect(timeLeft('2026-10-26T09:18:00Z', 'new', now)).toEqual({
      text: '22 min late',
      late: true,
      soon: false
    });
    expect(timeLeft('2026-10-29T09:40:00Z', 'new', now)?.text).toBe('3 days');
  });
  it('shows who checks, or done, once the work is finished', () => {
    expect(timeLeft('2026-10-26T09:18:00Z', 'resolved', now)).toBeNull();
    expect(timeCell({ dueAt: null, status: 'resolved', source: 'call_center' })).toEqual({
      text: 'Call Center'
    });
    expect(timeCell({ dueAt: null, status: 'resolved', source: 'nms' })).toEqual({ text: 'NOC' });
    expect(timeCell({ dueAt: null, status: 'closed', source: 'call_center' })).toEqual({ text: 'Done' });
  });
  it('says how long something has waited', () => {
    expect(waitingFor('2026-10-26T09:28:00Z', now)).toBe('12 min');
    expect(waitingFor('2026-10-26T06:40:00Z', now)).toBe('3 h');
  });
});

describe('initials', () => {
  it('uses the first letters of the words, ignoring brackets', () => {
    expect(initials('Nádia Mussa')).toBe('NM');
    expect(initials('System (auto-assign)')).toBe('SA');
  });
});

describe('UserEditor', () => {
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

  it('asks for a team for field staff, only offers teams of the chosen area, then sends the account', async () => {
    const onSubmit = vi.fn();
    render(<UserEditor lookups={lookups} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Rui Langa');
    await userEvent.type(screen.getByLabelText('Username'), 'rui.langa');
    const create = screen.getByRole('button', { name: 'Create account' });
    expect(create).toBeDisabled();
    expect(screen.getByText('Field staff and team managers need a team.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Working area'), 'a2');
    const teamSelect = screen.getByLabelText('Team');
    expect([...teamSelect.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'No team',
      'South 2'
    ]);
    await userEvent.selectOptions(teamSelect, 't2');
    await userEvent.type(screen.getByLabelText('Phone for SMS'), '+258840000010');
    await userEvent.click(create);
    expect(onSubmit).toHaveBeenCalledWith({
      username: 'rui.langa',
      fullName: 'Rui Langa',
      email: undefined,
      phone: '+258840000010',
      roles: ['field_staff'],
      teamId: 't2'
    });
  });

  it('explains each role, does not need a team for NOC, and locks the username when editing', async () => {
    const onSubmit = vi.fn();
    const user: AdminUser = {
      id: 'u1',
      username: 'nadia.mussa',
      fullName: 'Nádia Mussa',
      email: null,
      phone: null,
      roles: ['noc'],
      teamId: null,
      teamName: null,
      areaName: null,
      status: 'active',
      onDuty: false,
      lastSeenAt: null,
      createdAt: '2026-10-26T08:00:00Z'
    };
    render(<UserEditor lookups={lookups} user={user} busy={false} onSubmit={onSubmit} />);
    expect(screen.getByLabelText('Username')).toBeDisabled();
    expect(screen.getByText(/checks network jobs and closes or reopens them/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ roles: ['noc'], teamId: null }));
  });
});
