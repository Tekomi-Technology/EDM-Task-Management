import type { NewCustomerCard, NewCustomerStage } from '../types';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { Avatar, useCrumbs } from '../components/ui';
import { formatWhen, PREMISES_LABEL, SUPPLY_LABEL } from '../format';
import { useRegion } from '../components/topbar';

const COLUMNS: { stage: NewCustomerStage; title: string; hint: string; color: string }[] = [
  {
    stage: 'survey_requested',
    title: 'Survey requested',
    hint: 'From Sales, waiting for a visit',
    color: '#667085'
  },
  { stage: 'survey_done', title: 'Survey done', hint: 'Result sent back to Sales', color: '#7a5af8' },
  {
    stage: 'contract_signed',
    title: 'Contract signed',
    hint: 'Sales asked for a connection',
    color: '#f39b3a'
  },
  { stage: 'being_connected', title: 'Being connected', hint: 'Staff on site', color: '#2e6be6' },
  {
    stage: 'connected',
    title: 'Connected',
    hint: 'Customer confirmed · activation by Sales',
    color: '#12b76a'
  }
];

const TONE: Record<string, string> = { good: 'badge-active', warn: 'badge-brand', bad: 'badge-blocked' };

/** W10: surveys and connections requested by the Sales system, by stage. */
export function NewCustomersPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: 'Tickets', to: '/tickets' }, { label: 'New customers' }]);
  const board = useQuery({
    queryKey: ['new-customers', areaId],
    queryFn: () => api<NewCustomerCard[]>(withArea('/new-customers')),
    refetchInterval: 30_000
  });
  const cards = board.data ?? [];

  return (
    <div className="content" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <h1>New customers</h1>
          <div className="subtitle">
            Survey and connection requests arrive from the Sales system. Results go back to Sales
            automatically.
          </div>
        </div>
      </div>
      {board.error && <div className="error">{(board.error as Error).message}</div>}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))',
          gap: 16,
          overflowX: 'auto',
          paddingBottom: 8
        }}
      >
        {COLUMNS.map((col) => {
          const inCol = cards.filter((c) => c.stage === col.stage);
          return (
            <section
              key={col.stage}
              style={{
                background: '#efeff2',
                borderRadius: 16,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                alignSelf: 'start'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: col.color,
                      display: 'inline-block'
                    }}
                  />
                  <strong style={{ flex: 1, fontSize: 15 }}>{col.title}</strong>
                  <span className="meta">{inCol.length}</span>
                </div>
                <div className="meta">{col.hint}</div>
              </div>
              {inCol.length === 0 && (
                <span className="meta" style={{ padding: '8px 2px' }}>
                  Nothing here.
                </span>
              )}
              {inCol.map((c) => (
                <Link
                  key={c.ticketId}
                  to={`/tickets/${c.ticketId}`}
                  className="card card-pad"
                  style={{ textDecoration: 'none', color: 'inherit', gap: 6, padding: 14 }}
                >
                  <strong style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{c.title}</strong>
                  <span className="meta" style={{ fontSize: 14 }}>
                    {c.place ?? 'No area yet'}
                  </span>
                  <span style={{ fontSize: 14 }}>
                    {[
                      c.premises ? PREMISES_LABEL[c.premises] : null,
                      c.supply ? SUPPLY_LABEL[c.supply] : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {c.badge && (
                    <span
                      className={`badge ${c.badgeTone ? TONE[c.badgeTone] : ''}`}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {c.badge}
                    </span>
                  )}
                  <span
                    style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}
                  >
                    <span className="person" style={{ fontSize: 14 }}>
                      <Avatar
                        name={c.assignee?.fullName ?? '?'}
                        size="sm"
                        kind={c.assignee ? undefined : 'nobody'}
                      />
                      {c.assignee?.fullName ?? <span className="meta">Nobody yet</span>}
                    </span>
                    <span className="meta">{formatWhen(c.date)}</span>
                  </span>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
