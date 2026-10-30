import type { WaitingSurvey } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { SurveyPicker } from './SurveyPicker';

vi.mock('../api', () => ({ api: vi.fn() }));

const survey = (code: string, fullName: string): WaitingSurvey => ({
  ticketId: code,
  code,
  customer: { fullName, phone: '+258849000001', address: 'Matola Gare' },
  premises: 'school',
  supply: 'three_phase',
  requestedLoadKw: 15,
  result: 'feasible',
  distanceToNetworkM: 60,
  nearestElement: 'P-12',
  worksNeeded: null,
  surveyedBy: 'Ana Sitoe',
  surveyedAt: null,
  team: { id: 't1', name: 'South 1' },
  teamStaff: 2,
  depot: null,
  materials: []
});

function Picker() {
  const [value, setValue] = useState<WaitingSurvey | null>(null);
  return <SurveyPicker value={value} onChange={setValue} />;
}

describe('SurveyPicker', () => {
  it('lists nothing until something is typed, and keeps the chosen survey in view', async () => {
    vi.mocked(api).mockResolvedValue([survey('TK-26-00024', 'Minh hằng'), survey('TK-26-00021', 'Escola')]);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<Picker />, { wrapper });
    expect(await screen.findByText(/2 finished surveys are waiting/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    const search = screen.getByLabelText('Find a survey');
    await userEvent.type(search, 'TK-26-00024');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    await userEvent.click(screen.getByRole('radio'));
    await userEvent.clear(search);
    expect(screen.getByRole('radio', { checked: true })).toHaveTextContent('Minh hằng');
  });
});
