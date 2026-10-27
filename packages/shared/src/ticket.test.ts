import { describe, expect, it } from 'vitest';
import { allowedActions, nextStatus, TransitionError } from './ticket.js';

const manager = { userId: 'm1', roles: ['team_manager'] as const };
const staff = { userId: 's1', roles: ['field_staff'] as const };
const otherStaff = { userId: 's2', roles: ['field_staff'] as const };
const callCenter = { userId: null, roles: ['integration_call_center'] as const };
const noc = { userId: 'n1', roles: ['noc'] as const };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof TransitionError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('ticket state machine', () => {
  it('walks the sample flow from new to closed', () => {
    let s = nextStatus('new', 'assign', manager, null);
    expect(s).toBe('assigned');
    s = nextStatus(s, 'accept', staff, 's1');
    expect(s).toBe('accepted');
    s = nextStatus(s, 'start', staff, 's1');
    expect(s).toBe('in_progress');
    s = nextStatus(s, 'resolve', staff, 's1');
    expect(s).toBe('resolved');
    expect(nextStatus(s, 'close', callCenter, 's1')).toBe('closed');
  });

  it('reopens a resolved ticket and lets the manager assign it again', () => {
    const reopened = nextStatus('resolved', 'reopen', callCenter, 's1');
    expect(reopened).toBe('reopened');
    expect(nextStatus(reopened, 'assign', manager, 's1')).toBe('assigned');
  });

  it('lets staff decline a job before starting it, sending it back to new', () => {
    expect(nextStatus('assigned', 'decline', staff, 's1')).toBe('new');
    expect(nextStatus('accepted', 'decline', staff, 's1')).toBe('new');
    expect(codeOf(() => nextStatus('in_progress', 'decline', staff, 's1'))).toBe('INVALID_TRANSITION');
  });

  it('lets staff pause and resume work', () => {
    const held = nextStatus('in_progress', 'hold', staff, 's1');
    expect(held).toBe('on_hold');
    expect(codeOf(() => nextStatus(held, 'resolve', staff, 's1'))).toBe('INVALID_TRANSITION');
    expect(nextStatus(held, 'resume', staff, 's1')).toBe('in_progress');
  });

  it('lets a manager move a job to someone else even while it is being worked on', () => {
    expect(nextStatus('in_progress', 'assign', manager, 's1')).toBe('assigned');
    expect(nextStatus('on_hold', 'assign', manager, 's1')).toBe('assigned');
  });

  it('cancels unfinished tickets but never finished ones', () => {
    expect(nextStatus('new', 'cancel', callCenter, null)).toBe('cancelled');
    expect(nextStatus('in_progress', 'cancel', noc, 's1')).toBe('cancelled');
    expect(codeOf(() => nextStatus('closed', 'cancel', noc, 's1'))).toBe('INVALID_TRANSITION');
    expect(codeOf(() => nextStatus('cancelled', 'reopen', noc, 's1'))).toBe('INVALID_TRANSITION');
    expect(codeOf(() => nextStatus('new', 'cancel', staff, null))).toBe('FORBIDDEN_ROLE');
  });

  it('rejects an action from the wrong status', () => {
    expect(codeOf(() => nextStatus('new', 'close', callCenter, null))).toBe('INVALID_TRANSITION');
    expect(codeOf(() => nextStatus('closed', 'reopen', callCenter, 's1'))).toBe('INVALID_TRANSITION');
  });

  it('rejects a role that may not do the action', () => {
    expect(codeOf(() => nextStatus('new', 'assign', staff, null))).toBe('FORBIDDEN_ROLE');
    expect(codeOf(() => nextStatus('resolved', 'close', staff, 's1'))).toBe('FORBIDDEN_ROLE');
  });

  it('only lets the assigned staff member work on the ticket', () => {
    expect(codeOf(() => nextStatus('assigned', 'accept', otherStaff, 's1'))).toBe('NOT_ASSIGNEE');
    expect(codeOf(() => nextStatus('in_progress', 'hold', otherStaff, 's1'))).toBe('NOT_ASSIGNEE');
  });

  it('lists the actions available to each person', () => {
    expect(allowedActions('assigned', staff, 's1')).toEqual(['accept', 'decline']);
    expect(allowedActions('in_progress', staff, 's1')).toEqual(['hold', 'resolve']);
    expect(allowedActions('assigned', otherStaff, 's1')).toEqual([]);
    expect(allowedActions('resolved', callCenter, 's1')).toEqual(['close', 'reopen', 'cancel']);
    expect(allowedActions('closed', manager, 's1')).toEqual([]);
  });
});
