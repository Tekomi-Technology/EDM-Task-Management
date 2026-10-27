import type {
  MovementView,
  StaffMember,
  StockItemView,
  StockLine,
  StockLocationView,
  VehicleView
} from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { hasRole, useCrumbs, useMe } from '../components/ui';
import { formatWhen, MOVEMENT_LABEL, qty } from '../format';

const LEVEL: Record<string, { label: string; className: string }> = {
  good: { label: 'Good', className: 'badge-active' },
  watch: { label: 'Watch', className: 'badge-on_hold' },
  low: { label: 'Low', className: 'badge-blocked' }
};

type Tab = 'catalog' | 'places' | 'vans' | 'movements';
type Form = 'receive' | 'transfer' | 'adjust' | null;

/** Item lines in the stock forms. */
function Lines({
  items,
  lines,
  onChange,
  available
}: {
  items: StockItemView[];
  lines: { itemId: string; quantity: string }[];
  onChange: (lines: { itemId: string; quantity: string }[]) => void;
  /** What the source place holds, to show beside each item. */
  available?: StockLine[];
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {lines.map((l, i) => {
        const item = items.find((x) => x.id === l.itemId);
        const there = available?.find((a) => a.itemId === l.itemId);
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              aria-label="Item"
              style={{ flex: 1 }}
              value={l.itemId}
              onChange={(e) =>
                onChange(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
              }
            >
              <option value="">Choose an item…</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.code})
                </option>
              ))}
            </select>
            <input
              aria-label="Quantity"
              type="number"
              min={0}
              step="any"
              style={{ width: 110 }}
              value={l.quantity}
              onChange={(e) =>
                onChange(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
              }
            />
            <span className="meta" style={{ width: 110 }}>
              {item ? item.unit : ''}
              {there ? ` · ${qty(there.quantity - there.reserved, there.unit)} free` : ''}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              aria-label="Remove line"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...lines, { itemId: '', quantity: '' }])}
      >
        <Plus size={14} /> Add item
      </button>
    </div>
  );
}

function StockForm({
  form,
  items,
  places,
  onDone,
  onClose
}: {
  form: Exclude<Form, null>;
  items: StockItemView[];
  places: StockLocationView[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const depots = places.filter((p) => p.kind === 'depot');
  const vans = places.filter((p) => p.kind === 'van');
  const [from, setFrom] = useState(depots[0]?.id ?? '');
  const [to, setTo] = useState(form === 'transfer' ? (vans[0]?.id ?? '') : (depots[0]?.id ?? ''));
  const [lines, setLines] = useState([{ itemId: '', quantity: '' }]);
  const [reference, setReference] = useState('');
  const [itemId, setItemId] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const source = useQuery({
    queryKey: ['stock-place', from],
    queryFn: () => api<StockLine[]>(`/stock/locations/${from}`),
    enabled: form === 'transfer' && !!from
  });
  const valid = lines
    .filter((l) => l.itemId && Number(l.quantity) > 0)
    .map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }));

  const save = useMutation({
    mutationFn: async () => {
      if (form === 'receive') {
        await api('/stock/receive', {
          method: 'POST',
          body: { locationId: to, lines: valid, reference: reference || undefined }
        });
        return `Received ${valid.length} ${valid.length === 1 ? 'item' : 'items'}.`;
      }
      if (form === 'transfer') {
        await api('/stock/transfer', {
          method: 'POST',
          body: { fromLocationId: from, toLocationId: to, lines: valid }
        });
        return 'Stock moved.';
      }
      const r = await api<{ difference: number }>('/stock/adjust', {
        method: 'POST',
        body: { locationId: to, itemId, countedQuantity: Number(counted), reason }
      });
      return r.difference === 0
        ? 'The count matches the books.'
        : `Corrected by ${r.difference > 0 ? '+' : ''}${r.difference}.`;
    },
    onSuccess: onDone
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const ready =
    form === 'adjust'
      ? !!to && !!itemId && counted !== '' && reason.trim().length >= 3
      : valid.length > 0 && !!to && (form !== 'transfer' || (!!from && from !== to));

  return (
    <form className="card card-pad" style={{ gap: 14 }} onSubmit={submit} aria-label="Stock form">
      <h2>
        {form === 'receive'
          ? 'Receive stock into a depot'
          : form === 'transfer'
            ? 'Give to a van, or move stock'
            : 'Correct a count'}
      </h2>
      <div className="form-grid">
        {form === 'transfer' && (
          <div className="field">
            <label htmlFor="s-from">From</label>
            <select id="s-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="s-to">{form === 'transfer' ? 'To' : form === 'receive' ? 'Depot' : 'Place'}</label>
          <select id="s-to" value={to} onChange={(e) => setTo(e.target.value)}>
            {(form === 'receive' ? depots : places).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {form === 'receive' && (
          <div className="field">
            <label htmlFor="s-ref">Delivery note (optional)</label>
            <input id="s-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}
      </div>
      {form === 'adjust' ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="s-item">Item</label>
            <select id="s-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choose an item…</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-count">Counted quantity</label>
            <input
              id="s-count"
              type="number"
              min={0}
              step="any"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="s-reason">Why</label>
            <input
              id="s-reason"
              value={reason}
              placeholder="e.g. Monthly count"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <Lines
          items={items}
          lines={lines}
          onChange={setLines}
          available={form === 'transfer' ? source.data : undefined}
        />
      )}
      {save.error && <div className="error">{(save.error as ApiRequestError).message}</div>}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Vans({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const vans = useQuery({ queryKey: ['vehicles'], queryFn: () => api<VehicleView[]>('/vehicles') });
  const teamIds = [...new Set((vans.data ?? []).map((v) => v.teamId))];
  const staff = useQuery({
    queryKey: ['van-staff', teamIds.join(',')],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(teamIds.map(async (id) => [id, await api<StaffMember[]>(`/teams/${id}/staff`)]))
      ),
    enabled: canManage && teamIds.length > 0
  });
  const assign = useMutation({
    mutationFn: (v: { id: string; userId: string | null }) =>
      api<VehicleView[]>(`/vehicles/${v.id}/assign`, { method: 'POST', body: { userId: v.userId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] })
  });
  return (
    <>
      {assign.error && (
        <div className="error" style={{ margin: 16 }}>
          {(assign.error as ApiRequestError).message}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Van</th>
              <th>Team</th>
              <th>Driver</th>
              <th className="right">Items on board</th>
            </tr>
          </thead>
          <tbody>
            {(vans.data ?? []).map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.plate}</strong>
                  <div className="meta">{v.label}</div>
                </td>
                <td>{v.teamName}</td>
                <td>
                  {canManage ? (
                    <select
                      aria-label={`Driver of ${v.plate}`}
                      value={v.assignedTo?.id ?? ''}
                      onChange={(e) => assign.mutate({ id: v.id, userId: e.target.value || null })}
                    >
                      <option value="">Nobody</option>
                      {((staff.data?.[v.teamId] as StaffMember[] | undefined) ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.fullName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (v.assignedTo?.fullName ?? <span className="meta">Nobody</span>)
                  )}
                </td>
                <td className="right">{v.itemsOnBoard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** W14: the stock ledger — catalogue, depots and vans, and every movement. */
export function StockPage() {
  useCrumbs([{ label: 'Field' }, { label: 'Stock' }]);
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasRole(me.data, 'admin', 'technical_manager', 'team_manager');
  const [tab, setTab] = useState<Tab>('catalog');
  const [form, setForm] = useState<Form>(null);
  const [done, setDone] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState('');
  const items = useQuery({ queryKey: ['stock-items'], queryFn: () => api<StockItemView[]>('/stock/items') });
  const places = useQuery({
    queryKey: ['stock-places'],
    queryFn: () => api<StockLocationView[]>('/stock/locations')
  });
  const currentPlace = placeId || places.data?.[0]?.id || '';
  const place = useQuery({
    queryKey: ['stock-place', currentPlace],
    queryFn: () => api<StockLine[]>(`/stock/locations/${currentPlace}`),
    enabled: tab === 'places' && !!currentPlace
  });
  const movements = useQuery({
    queryKey: ['stock-movements'],
    queryFn: () => api<MovementView[]>('/stock/movements?limit=200'),
    enabled: tab === 'movements'
  });

  const refresh = (message: string) => {
    setDone(message);
    setForm(null);
    void queryClient.invalidateQueries({ queryKey: ['stock-items'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-place'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Stock</h1>
          <div className="subtitle">
            Depots and staff vans. Materials used on a ticket are deducted when it closes.
          </div>
        </div>
        {canManage && (
          <div className="btn-row">
            <button type="button" className="btn btn-lg" onClick={() => setForm('receive')}>
              Receive stock
            </button>
            <button type="button" className="btn btn-lg" onClick={() => setForm('adjust')}>
              Correct a count
            </button>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setForm('transfer')}>
              Give to a van
            </button>
          </div>
        )}
      </div>
      {done && <div className="notice">{done}</div>}
      {form && items.data && places.data && (
        <StockForm
          form={form}
          items={items.data}
          places={places.data}
          onDone={refresh}
          onClose={() => setForm(null)}
        />
      )}

      <section className="card">
        <div className="tabs" role="tablist">
          {(
            [
              ['catalog', 'All items'],
              ['places', 'Depots & vans'],
              ['vans', 'Vans'],
              ['movements', 'Movements']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'catalog' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Code</th>
                  <th className="right">In depots</th>
                  <th className="right">In vans</th>
                  <th className="right">Reserved</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
                {(items.data ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.name}</strong>
                    </td>
                    <td className="meta">{i.code}</td>
                    <td className="right">{qty(i.inDepots, i.unit)}</td>
                    <td className="right">{qty(i.inVans, i.unit)}</td>
                    <td className="right">{qty(i.reserved, i.unit)}</td>
                    <td>
                      <span className={`badge ${LEVEL[i.level]!.className}`}>{LEVEL[i.level]!.label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'places' && (
          <>
            <div className="filters">
              <select aria-label="Place" value={currentPlace} onChange={(e) => setPlaceId(e.target.value)}>
                {(places.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.teamName ? ` · ${p.teamName}` : p.areaName ? ` · ${p.areaName}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {place.data?.length === 0 && <div className="empty">Nothing here.</div>}
            {place.data && place.data.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Code</th>
                      <th className="right">Quantity</th>
                      <th className="right">Reserved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {place.data.map((l) => (
                      <tr key={l.itemId}>
                        <td>
                          <strong>{l.name}</strong>
                        </td>
                        <td className="meta">{l.code}</td>
                        <td className={['right', l.quantity < 0 ? 'late' : ''].join(' ')}>
                          {qty(l.quantity, l.unit)}
                        </td>
                        <td className="right">{qty(l.reserved, l.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'vans' && <Vans canManage={canManage} />}

        {tab === 'movements' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Item</th>
                  <th className="right">Quantity</th>
                  <th>From → to</th>
                  <th>Ticket / note</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {(movements.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="meta">{formatWhen(m.createdAt)}</td>
                    <td>{MOVEMENT_LABEL[m.kind]}</td>
                    <td>{m.itemName}</td>
                    <td className="right">{qty(m.quantity, m.unit)}</td>
                    <td>
                      {m.from ?? '—'} → {m.to ?? (m.kind === 'consume' ? 'used' : '—')}
                    </td>
                    <td className="wrap" style={{ minWidth: 140 }}>
                      {m.ticket ? (
                        <Link to={`/tickets/${m.ticket.id}`}>{m.ticket.code}</Link>
                      ) : (
                        (m.note ?? m.reference ?? '')
                      )}
                    </td>
                    <td className="meta">{m.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
