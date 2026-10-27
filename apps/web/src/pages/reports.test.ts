import { describe, expect, it } from 'vitest';
import { duration, periodDates } from './ReportsPage';

describe('report periods and durations', () => {
  it('turns a period choice into whole days ending today', () => {
    expect(periodDates('14', '2026-10-27')).toEqual({ from: '2026-10-14', to: '2026-10-27' });
    expect(periodDates('7', '2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' });
    expect(periodDates('month', '2026-10-27')).toEqual({ from: '2026-10-01', to: '2026-10-27' });
    expect(periodDates('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('writes durations the way people say them', () => {
    expect(duration(null)).toBe('—');
    expect(duration(0)).toBe('Under 1 min');
    expect(duration(35)).toBe('35 min');
    expect(duration(161)).toBe('2 h 41 min');
    expect(duration(120)).toBe('2 h');
    expect(duration(1560)).toBe('1 day 2 h');
    expect(duration(2880)).toBe('2 days');
  });
});
