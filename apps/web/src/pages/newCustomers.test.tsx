import type { NewCustomerCard } from '../types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { NewCustomersPage } from './NewCustomersPage';

vi.mock('../api', () => ({ api: vi.fn() }));

const card = (over: Partial<NewCustomerCard>): NewCustomerCard => ({
  ticketId: 't1',
  code: 'TK-26-00012',
  stage: 'survey_requested',
  title: 'Hữu Tú',
  place: null,
  premises: null,
  supply: null,
  badge: null,
  badgeTone: null,
  assignee: null,
  date: '2026-10-29T08:46:00Z',
  ...over
});

describe('the New customers board', () => {
  it('shows the ticket code on each card, and only the lines it has data for', async () => {
    vi.mocked(api).mockResolvedValue([
      card({ premises: 'home', supply: 'single_phase', place: 'Matola · South 1' }),
      card({ ticketId: 't2', code: 'TK-26-00013', title: 'Maria Cossa' })
    ]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NewCustomersPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const first = (await screen.findByText('TK-26-00012')).closest('a')!;
    expect(first).toHaveTextContent('Hữu Tú');
    expect(first).toHaveTextContent('Home · single-phase');
    expect(first).toHaveTextContent('Matola · South 1');

    // No premises or supply: no empty line for them.
    const second = screen.getByText('TK-26-00013').closest('a')!;
    expect(second).toHaveTextContent('Maria Cossa');
    expect(second.querySelectorAll('.board-card-line')).toHaveLength(1);
  });
});
