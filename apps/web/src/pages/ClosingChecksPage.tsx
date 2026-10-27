import type { TicketDetail, TicketSummary } from '@edm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Phone, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { useCrumbs } from '../components/ui';
import { formatWhen, waitingFor } from '../format';
import { useRegion } from '../components/topbar';

type Queue = 'call_center' | 'noc';

/** Network work is checked by NOC; customer work by the Call Center, which calls the customer back. */
const NETWORK_TYPES: string[] = ['network_incident', 'planned_work'];

function CheckPanel({ id, queue }: { id: string; queue: Queue }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<'fixed' | 'not_fixed'>('fixed');
  const [note, setNote] = useState('');
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => api<TicketDetail>(`/tickets/${id}`) });
  const record = useMutation({
    mutationFn: () =>
      api<TicketDetail>(`/tickets/${id}/${result === 'fixed' ? 'close' : 'reopen'}`, {
        method: 'POST',
        body: { note: note.trim() || undefined }
      }),
    onSuccess: () => {
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['checks'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-counts'] });
    }
  });

  const t = ticket.data;
  if (!t) return <section className="card empty">Loading…</section>;
  const resolved = [...t.events].reverse().find((e) => e.type === 'resolve');
  const photos = t.attachments.filter((a) => a.url);
  const canRecord = t.allowedActions.includes('close');

  return (
    <section className="card card-pad" style={{ gap: 18, padding: '24px 28px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>
            <StatusBadge status={t.status} />
          </span>
          <h2 style={{ fontSize: 24 }}>{t.title}</h2>
          <span className="meta" style={{ fontSize: 15 }}>
            {[t.code, t.customer?.fullName, t.customer?.address].filter(Boolean).join(' · ')}
          </span>
        </div>
        <Link className="btn" to={`/tickets/${t.id}`}>
          Open ticket
        </Link>
      </div>

      <div className="facts">
        <div className="box">
          <span className="label">What they did</span>
          <strong style={{ fontWeight: 500 }}>{String(resolved?.data.note ?? '—')}</strong>
        </div>
        <div className="box">
          <span className="label">Done by</span>
          <strong style={{ fontWeight: 500 }}>
            {t.assignee?.fullName ?? '—'}
            {resolved ? ` · ${formatWhen(resolved.createdAt)}` : ''}
          </strong>
        </div>
        <div className="box">
          <span className="label">Photos</span>
          <span>
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            {photos.map((p, i) => (
              <span key={p.id}>
                {' · '}
                <a href={p.url!} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                  View{photos.length > 1 ? ` ${i + 1}` : ''}
                </a>
              </span>
            ))}
          </span>
        </div>
      </div>

      {t.customer?.phone && (
        <div className="call-box">
          <span className="icon">
            <Phone size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <strong>Call the customer</strong>
            <div style={{ color: 'var(--brand-text)' }}>
              {t.customer.fullName} · {t.customer.phone} · ask if the power is back
            </div>
          </div>
          <a className="btn btn-soft" href={`tel:${t.customer.phone}`}>
            Call now
          </a>
        </div>
      )}

      {queue === 'call_center' && (
        <div className="notice">
          The Call Center system normally sends this result after calling the customer.
          {canRecord ? ' Record it here only if it cannot.' : ''}
        </div>
      )}

      {canRecord ? (
        <>
          <h2>Result of the check</h2>
          <div className="btn-row">
            <button
              type="button"
              className="result-choice"
              aria-pressed={result === 'fixed'}
              onClick={() => setResult('fixed')}
            >
              <Check size={20} color="var(--ok)" />{' '}
              {queue === 'call_center' ? 'Customer says power is back' : 'Fault is cleared'}
            </button>
            <button
              type="button"
              className="result-choice"
              aria-pressed={result === 'not_fixed'}
              onClick={() => setResult('not_fixed')}
            >
              <X size={20} color="var(--late)" /> Problem is not fixed
            </button>
          </div>
          <textarea
            rows={3}
            aria-label="Note"
            placeholder="Note (what the customer or NOC said)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {record.error && <div className="error">{(record.error as ApiRequestError).message}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={record.isPending}
              onClick={() => record.mutate()}
            >
              {result === 'fixed' ? 'Close ticket' : 'Send back to the team'}
            </button>
          </div>
        </>
      ) : (
        <span className="meta">NOC and administrators record the result.</span>
      )}
    </section>
  );
}

/** Jobs staff say are done, waiting for the Call Center or NOC to confirm before closing. */
export function ClosingChecksPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: 'Tickets', to: '/tickets' }, { label: 'Closing checks' }]);
  const [queue, setQueue] = useState<Queue>('call_center');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['checks', areaId],
    queryFn: () => api<{ items: TicketSummary[] }>(withArea('/tickets?view=waiting_check&limit=100')),
    refetchInterval: 30_000
  });
  const all = list.data?.items ?? [];
  // Oldest first: they have waited longest.
  const byQueue = (q: Queue) =>
    all
      .filter((t) => (q === 'call_center') === !NETWORK_TYPES.includes(t.type))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const items = byQueue(queue);
  const current = items.find((t) => t.id === selected) ?? items[0];

  return (
    <div className="content">
      <div>
        <h1>Closing checks</h1>
        <div className="subtitle">
          Staff say these jobs are done. Confirm with the customer or the network, then close or send back.
        </div>
      </div>
      <div className="segmented">
        {(['call_center', 'noc'] as const).map((q) => (
          <button
            key={q}
            type="button"
            aria-pressed={queue === q}
            onClick={() => {
              setQueue(q);
              setSelected(null);
            }}
          >
            {q === 'call_center' ? 'Call Center checks' : 'NOC checks'}
            <span className="pill-count">{byQueue(q).length}</span>
          </button>
        ))}
      </div>
      {list.error && <div className="error">{(list.error as Error).message}</div>}
      {list.data && items.length === 0 ? (
        <section className="card empty">Nothing is waiting for a check here.</section>
      ) : (
        <div className="two-col" style={{ gridTemplateColumns: 'minmax(280px, 400px) minmax(0, 1fr)' }}>
          <section className="card queue" aria-label="Waiting for check">
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={current?.id === t.id}
                onClick={() => setSelected(t.id)}
              >
                <span className="row">
                  <strong style={{ fontSize: 15 }}>{t.title}</strong>
                  <span className="meta" style={{ whiteSpace: 'nowrap' }}>
                    waiting {waitingFor(t.updatedAt)}
                  </span>
                </span>
                <span className="meta" style={{ fontSize: 14 }}>
                  {[t.code, t.areaName, t.assignee?.fullName].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </section>
          {current && <CheckPanel key={current.id} id={current.id} queue={queue} />}
        </div>
      )}
    </div>
  );
}
