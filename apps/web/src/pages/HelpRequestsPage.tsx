import type { HelpRequestView, HelpStatus } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { useCrumbs } from '../components/ui';
import { ago, formatTime, HELP_KIND_LABEL } from '../format';
import { useRegion } from '../components/topbar';

const STATUS: Record<HelpStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'badge-late' },
  in_progress: { label: 'Being helped', className: 'badge-assigned' },
  solved: { label: 'Solved', className: 'badge-active' }
};

const QUICK = [
  'A second person is on the way.',
  'A truck is on the way.',
  'We asked NOC to switch the line off; wait for their call.'
];

function Conversation({ request }: { request: HelpRequestView }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: (v: { body: string; status?: HelpStatus }) =>
      api<HelpRequestView>(`/help-requests/${request.id}/messages`, { method: 'POST', body: v }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['help'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-counts'] });
    }
  });
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 20 }}>{HELP_KIND_LABEL[request.kind]}</h2>
          <span className="meta" style={{ fontSize: 14 }}>
            {request.requestedBy.fullName}
            {request.teamName ? ` · Team ${request.teamName}` : ''}
            {request.ticket && (
              <>
                {' · '}
                <Link to={`/tickets/${request.ticket.id}`} style={{ fontWeight: 700 }}>
                  {request.ticket.code} · {request.ticket.title}
                </Link>
              </>
            )}
          </span>
        </div>
        {request.requestedBy.phone && (
          <a className="btn" href={`tel:${request.requestedBy.phone}`}>
            <Phone size={16} /> Call
          </a>
        )}
      </div>
      <div
        style={{
          background: 'var(--surface-2)',
          padding: '18px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 220
        }}
      >
        {request.messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.fromField ? 'flex-start' : 'flex-end', maxWidth: '80%' }}>
            <div className="meta" style={{ textAlign: m.fromField ? 'left' : 'right' }}>
              {m.authorName} · {formatTime(m.createdAt)}
            </div>
            <div
              className="note"
              style={{
                background: m.fromField ? 'var(--surface)' : 'var(--brand-soft)',
                borderColor: m.fromField ? undefined : 'var(--brand-line)'
              }}
            >
              {m.body}
            </div>
          </div>
        ))}
      </div>
      {request.status !== 'solved' ? (
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="btn-row" style={{ gap: 8 }}>
            {QUICK.map((q) => (
              <button key={q} type="button" className="btn btn-sm" onClick={() => setText(q)}>
                {q.split(' ').slice(0, 4).join(' ')}…
              </button>
            ))}
          </div>
          {send.error && <div className="error">{(send.error as ApiRequestError).message}</div>}
          <form
            style={{ display: 'flex', gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) send.mutate({ body: text.trim() });
            }}
          >
            <input
              aria-label="Reply"
              style={{ flex: 1 }}
              placeholder="Write a reply…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!text.trim() || send.isPending}>
              Send
            </button>
            <button
              type="button"
              className="btn"
              disabled={send.isPending}
              onClick={() => send.mutate({ body: text.trim() || 'Solved.', status: 'solved' })}
            >
              Mark solved
            </button>
          </form>
        </div>
      ) : (
        <div className="empty" style={{ padding: 18 }}>
          Solved {ago(request.updatedAt)}.
        </div>
      )}
    </section>
  );
}

/** W13: field staff ask the back office (BO) for help from the app; answer here. */
export function HelpRequestsPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: 'Field' }, { label: 'Help requests' }]);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['help', areaId],
    queryFn: () => api<HelpRequestView[]>(withArea('/help-requests')),
    refetchInterval: 15_000
  });
  const items = list.data ?? [];
  const current = items.find((r) => r.id === selected) ?? items[0];

  return (
    <div className="content">
      <div>
        <h1>Help requests</h1>
        <div className="subtitle">
          Field staff ask the back-office (BO) team for help from the app. Answer here.
        </div>
      </div>
      {list.data && items.length === 0 ? (
        <section className="card empty">No help requests.</section>
      ) : (
        <div className="two-col" style={{ gridTemplateColumns: 'minmax(280px, 420px) minmax(0, 1fr)' }}>
          <section className="card queue">
            {items.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-current={current?.id === r.id}
                onClick={() => setSelected(r.id)}
              >
                <span className="row">
                  <span className={`badge ${STATUS[r.status].className}`}>{STATUS[r.status].label}</span>
                  <span className="meta">{ago(r.createdAt)}</span>
                </span>
                <strong style={{ fontSize: 15 }}>{r.message}</strong>
                <span className="meta" style={{ fontSize: 14 }}>
                  {[r.requestedBy.fullName, r.ticket?.code].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </section>
          {current && <Conversation key={current.id} request={current} />}
        </div>
      )}
    </div>
  );
}
