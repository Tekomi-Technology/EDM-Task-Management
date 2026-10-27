import type {
  IntegrationCallView,
  IntegrationStatus,
  IntegrationSystem,
  IntegrationsOverview,
  IntegrationTestResult
} from '@edm/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, Home as HomeIcon, MessageSquare, Package, Phone, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useCrumbs } from '../components/ui';
import { ago, formatWhen } from '../format';

const SYSTEMS: Record<IntegrationSystem, { name: string; icon: ReactNode; about: string; last: string }> = {
  call_center: {
    name: 'Call Center',
    icon: <Phone size={22} />,
    about: 'Sends complaints from 1455 and public reports. Gets back the result of each ticket.',
    last: 'Last message'
  },
  sales: {
    name: 'Sales system',
    icon: <HomeIcon size={22} />,
    about:
      'Sends survey and connection requests for new customers. Gets back survey results and connection dates.',
    last: 'Last message'
  },
  nms: {
    name: 'Network management (NMS)',
    icon: <Zap size={22} />,
    about: 'Sends network alarms. Alarms with the same cause become one incident.',
    last: 'Last alarm'
  },
  stock: {
    name: 'Stock management',
    icon: <Package size={22} />,
    about: 'Books deliveries to the depots and reads the materials used on each closed ticket.',
    last: 'Last sync'
  },
  sms: {
    name: 'SMS gateway',
    icon: <MessageSquare size={22} />,
    about: 'Sends SMS to staff, team managers and customers.',
    last: 'Last SMS'
  },
  push: {
    name: 'Push notifications',
    icon: <Bell size={22} />,
    about: 'Sends new jobs and replies to the EDM Field app (Expo push service).',
    last: 'Last notification'
  }
};

const STATUS: Record<IntegrationStatus, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'badge badge-active' },
  slow: { label: 'Slow', className: 'badge badge-brand' },
  problem: { label: 'Problem', className: 'badge badge-late' },
  quiet: { label: 'No contact yet', className: 'badge badge-cancelled' },
  not_set: { label: 'Test mode', className: 'badge badge-cancelled' }
};

function SystemCard({
  view,
  onLog
}: {
  view: IntegrationsOverview['systems'][number];
  onLog: (s: IntegrationSystem) => void;
}) {
  const info = SYSTEMS[view.system];
  const status = STATUS[view.status];
  const test = useMutation({
    mutationFn: () => api<IntegrationTestResult>(`/integrations/${view.system}/test`, { method: 'POST' })
  });
  return (
    <section className="card card-pad" style={{ gap: 14 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div
          aria-hidden
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: 'var(--brand-soft)',
            color: 'var(--brand-text)',
            display: 'grid',
            placeItems: 'center',
            flex: 'none'
          }}
        >
          {info.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{info.name}</h2>
          <div className="meta">
            {view.lastOkAt ? `${info.last} ${ago(view.lastOkAt)}` : 'Nothing received or sent yet'}
          </div>
        </div>
        <span className={status.className}>{status.label}</span>
      </div>
      <p style={{ margin: 0 }}>{info.about}</p>
      <div className="meta">Today: {view.today}</div>
      {view.note && (
        <div
          className={view.status === 'problem' ? 'error' : 'notice'}
          style={{ margin: 0, overflowWrap: 'anywhere' }}
        >
          {view.note}
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 'auto' }}>
        <button type="button" className="btn" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? 'Testing…' : 'Test connection'}
        </button>
        <button type="button" className="btn" onClick={() => onLog(view.system)}>
          View log
        </button>
      </div>
      {test.data && (
        <div role="status" className={test.data.ok ? 'notice' : 'error'} style={{ margin: 0 }}>
          {test.data.message}
        </div>
      )}
      {test.error && (
        <div role="status" className="error" style={{ margin: 0 }}>
          {(test.error as Error).message}
        </div>
      )}
    </section>
  );
}

function CallLog({ system, onClose }: { system: IntegrationSystem; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const calls = useQuery({
    queryKey: ['integration-calls', system],
    queryFn: () => api<IntegrationCallView[]>(`/integrations/${system}/calls`),
    refetchInterval: 30_000
  });
  useEffect(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), [system]);
  return (
    <section className="card" ref={ref} aria-label={`Log of ${SYSTEMS[system].name}`}>
      <div className="card-head">
        <h2>Log · {SYSTEMS[system].name}</h2>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close the log">
          <X size={16} />
        </button>
      </div>
      {calls.data?.length === 0 ? (
        <div className="empty">Nothing yet.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Direction</th>
                <th>What</th>
                <th className="right">Answer</th>
                <th className="right">Took</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {calls.data?.map((c) => (
                <tr key={c.id}>
                  <td className="meta">{formatWhen(c.createdAt)}</td>
                  <td>{c.direction === 'in' ? 'Received' : 'Sent'}</td>
                  <td>{c.operation}</td>
                  <td className="right" style={c.ok ? undefined : { color: 'var(--late)', fontWeight: 700 }}>
                    {c.statusCode ?? (c.ok ? 'OK' : 'Failed')}
                  </td>
                  <td className="right">{c.durationMs.toLocaleString('en')} ms</td>
                  <td className="wrap meta">{c.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** W17: the other EDM systems that send work here or receive updates from here. */
export function ConnectedSystemsPage() {
  useCrumbs([{ label: 'Settings' }, { label: 'Connected systems' }]);
  const [log, setLog] = useState<IntegrationSystem | null>(null);
  const overview = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api<IntegrationsOverview>('/integrations'),
    refetchInterval: 30_000
  });
  const o = overview.data;
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Connected systems</h1>
          <div className="subtitle">
            Other EDM systems that send work to this system or receive updates from it.
          </div>
        </div>
      </div>
      {overview.error && <div className="error">{(overview.error as Error).message}</div>}
      {o && (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}
          >
            {o.systems.map((s) => (
              <SystemCard key={s.system} view={s} onLog={setLog} />
            ))}
          </div>
          {log && <CallLog system={log} onClose={() => setLog(null)} />}
          <section className="card">
            <div className="card-head">
              <h2>Recent problems</h2>
            </div>
            {o.problems.length === 0 ? (
              <div className="empty">No problems in the last 7 days.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <tbody>
                    {o.problems.map((p) => (
                      <tr key={`${p.system}-${p.firstAt}`}>
                        <td className="meta">{formatWhen(p.lastAt)}</td>
                        <td>
                          <strong>{SYSTEMS[p.system].name}</strong>
                        </td>
                        <td className="wrap">{p.message}</td>
                        <td className="right">
                          <span className={p.solved ? 'badge badge-active' : 'badge badge-brand'}>
                            {p.solved ? 'Solved' : 'Watching'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
