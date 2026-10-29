import type {
  Lookups,
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
import { t } from '../i18n';

const LEVEL: Record<string, { label: string; className: string }> = {
  good: { label: 'Good', className: 'badge-active' },
  watch: { label: 'Watch', className: 'badge-on_hold' },
  low: { label: 'Low', className: 'badge-blocked' }
};

type Tab = 'catalog' | 'places' | 'vans' | 'movements';
type Form = 'receive' | 'transfer' | 'adjust' | null;

/** The API's refusal in the person's words. */
function problem(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return (err as Error).message;
  if (err.error.code === 'AREA_HAS_DEPOT') return t('This area already has a depot.');
  if (err.error.code === 'DEPOT_CODE_TAKEN') return t('This code is already used by another depot or van.');
  return t(err.message);
}

/** Adds the depot of an area, or corrects the name and code of one. */
function DepotForm({
  depot,
  places,
  onDone,
  onClose
}: {
  /** The depot to correct; without it, a new one. */
  depot?: StockLocationView;
  places: StockLocationView[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups') });
  const withDepot = new Set(places.filter((p) => p.kind === 'depot').map((p) => p.areaId));
  const free = (lookups.data?.areas ?? []).filter((a) => !withDepot.has(a.id));
  const [name, setName] = useState(depot?.name ?? '');
  const [code, setCode] = useState(depot?.code ?? '');
  const [areaId, setAreaId] = useState('');
  const area = (depot ? depot.areaId : areaId || free[0]?.id) ?? '';
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), code: code.trim().toUpperCase() };
      if (depot) {
        await api(`/stock/depots/${depot.id}`, { method: 'PATCH', body });
        return t('Depot saved.');
      }
      await api('/stock/depots', { method: 'POST', body: { ...body, areaId: area } });
      return t('Depot added. Stock can now be received into it.');
    },
    onSuccess: onDone
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const ready = name.trim().length >= 2 && code.trim().length >= 2 && !!area;

  return (
    <form className="card card-pad" style={{ gap: 14 }} onSubmit={submit} aria-label={t('Depot')}>
      <h2>{depot ? t('Change depot') : t('Add a depot')}</h2>
      {!depot && lookups.data && free.length === 0 ? (
        <div className="notice">{t('Every area already has its depot.')}</div>
      ) : (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="d-name">{t('Name')}</label>
            <input
              id="d-name"
              value={name}
              placeholder={t('e.g. Matola depot')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="d-code">{t('Code in the stock system')}</label>
            <input
              id="d-code"
              value={code}
              placeholder="DEP-MATOLA"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="d-area">{t('Area')}</label>
            {depot ? (
              <input id="d-area" value={depot.areaName ?? ''} disabled />
            ) : (
              <select id="d-area" value={area} onChange={(e) => setAreaId(e.target.value)}>
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
      <div className="meta">
        {t(
          'Each area has one depot: stock for the area is received there, and its tickets reserve material from it. EDM’s stock system sends deliveries by the code.'
        )}
      </div>
      {save.error && <div className="error">{problem(save.error)}</div>}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>
          {t('Close')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending ? t('Saving…') : t('Save')}
        </button>
      </div>
    </form>
  );
}

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
              aria-label={t('Item')}
              style={{ flex: 1 }}
              value={l.itemId}
              onChange={(e) =>
                onChange(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
              }
            >
              <option value="">{t('Choose an item…')}</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.code})
                </option>
              ))}
            </select>
            <input
              aria-label={t('Quantity')}
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
              {there ? t(' · {0} free', { 0: qty(there.quantity - there.reserved, there.unit) }) : ''}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              aria-label={t('Remove line')}
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
        <Plus size={14} /> {t('Add item')}
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
        return t(valid.length === 1 ? 'Received {0} item.' : 'Received {0} items.', { 0: valid.length });
      }
      if (form === 'transfer') {
        await api('/stock/transfer', {
          method: 'POST',
          body: { fromLocationId: from, toLocationId: to, lines: valid }
        });
        return t('Stock moved.');
      }
      const r = await api<{ difference: number }>('/stock/adjust', {
        method: 'POST',
        body: { locationId: to, itemId, countedQuantity: Number(counted), reason }
      });
      return r.difference === 0
        ? t('The count matches the books.')
        : t('Corrected by {0}{1}.', { 0: r.difference > 0 ? '+' : '', 1: r.difference });
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
    <form className="card card-pad" style={{ gap: 14 }} onSubmit={submit} aria-label={t('Stock form')}>
      <h2>
        {form === 'receive'
          ? t('Receive stock into a depot')
          : form === 'transfer'
            ? t('Give to a van, or move stock')
            : t('Correct a count')}
      </h2>
      {form === 'receive' && depots.length === 0 && (
        <div className="notice">
          {t('There is no depot yet. An administrator or technical manager adds one with Add depot.')}
        </div>
      )}
      <div className="form-grid">
        {form === 'transfer' && (
          <div className="field">
            <label htmlFor="s-from">{t('From')}</label>
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
          <label htmlFor="s-to">
            {form === 'transfer' ? t('To') : form === 'receive' ? t('Depot') : t('Place')}
          </label>
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
            <label htmlFor="s-ref">{t('Delivery note (optional)')}</label>
            <input id="s-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}
      </div>
      {form === 'adjust' ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="s-item">{t('Item')}</label>
            <select id="s-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('Choose an item…')}</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-count">{t('Counted quantity')}</label>
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
            <label htmlFor="s-reason">{t('Why')}</label>
            <input
              id="s-reason"
              value={reason}
              placeholder={t('e.g. Monthly count')}
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
          {t('Close')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending ? t('Saving…') : t('Save')}
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
              <th>{t('Van')}</th>
              <th>{t('Team')}</th>
              <th>{t('Driver')}</th>
              <th className="right">{t('Items on board')}</th>
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
                      aria-label={t('Driver of {0}', { 0: v.plate })}
                      value={v.assignedTo?.id ?? ''}
                      onChange={(e) => assign.mutate({ id: v.id, userId: e.target.value || null })}
                    >
                      <option value="">{t('Nobody')}</option>
                      {((staff.data?.[v.teamId] as StaffMember[] | undefined) ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.fullName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (v.assignedTo?.fullName ?? <span className="meta">{t('Nobody')}</span>)
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
  useCrumbs([{ label: t('Field') }, { label: t('Stock') }]);
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasRole(me.data, 'admin', 'technical_manager', 'team_manager');
  const canSetUp = hasRole(me.data, 'admin', 'technical_manager');
  const [tab, setTab] = useState<Tab>('catalog');
  const [form, setForm] = useState<Form>(null);
  /** The depot form: 'new', or the depot being corrected. */
  const [depotForm, setDepotForm] = useState<'new' | StockLocationView | null>(null);
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
    setDepotForm(null);
    void queryClient.invalidateQueries({ queryKey: ['stock-places'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-items'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-place'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('Stock')}</h1>
          <div className="subtitle">
            {t('Depots and staff vans. Materials used on a ticket are deducted when it closes.')}
          </div>
        </div>
        {canManage && (
          <div className="btn-row">
            {canSetUp && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={() => {
                  setForm(null);
                  setDepotForm('new');
                }}
              >
                <Plus size={18} /> {t('Add depot')}
              </button>
            )}
            <button type="button" className="btn btn-lg" onClick={() => setForm('receive')}>
              {t('Receive stock')}
            </button>
            <button type="button" className="btn btn-lg" onClick={() => setForm('adjust')}>
              {t('Correct a count')}
            </button>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setForm('transfer')}>
              {t('Give to a van')}
            </button>
          </div>
        )}
      </div>
      {done && <div className="notice">{done}</div>}
      {depotForm && places.data && (
        <DepotForm
          key={depotForm === 'new' ? 'new' : depotForm.id}
          depot={depotForm === 'new' ? undefined : depotForm}
          places={places.data}
          onDone={refresh}
          onClose={() => setDepotForm(null)}
        />
      )}
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
              ['catalog', t('All items')],
              ['places', t('Depots & vans')],
              ['vans', t('Vans')],
              ['movements', t('Movements')]
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
                  <th>{t('Item')}</th>
                  <th>{t('Code')}</th>
                  <th className="right">{t('In depots')}</th>
                  <th className="right">{t('In vans')}</th>
                  <th className="right">{t('Reserved')}</th>
                  <th>{t('Level')}</th>
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
                      <span className={`badge ${LEVEL[i.level]!.className}`}>{t(LEVEL[i.level]!.label)}</span>
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
              <select
                aria-label={t('Place')}
                value={currentPlace}
                onChange={(e) => setPlaceId(e.target.value)}
              >
                {(places.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.teamName ? ` · ${p.teamName}` : p.areaName ? ` · ${p.areaName}` : ''}
                  </option>
                ))}
              </select>
              {canSetUp &&
                places.data?.find((p) => p.id === currentPlace && p.kind === 'depot') !== undefined && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setDepotForm(places.data!.find((p) => p.id === currentPlace)!)}
                  >
                    {t('Change depot')}
                  </button>
                )}
            </div>
            {places.data?.length === 0 && (
              <div className="empty">
                {t('No depots or vans yet. Start with the depot of each area: Add depot.')}
              </div>
            )}
            {place.data?.length === 0 && <div className="empty">{t('Nothing here.')}</div>}
            {place.data && place.data.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Item')}</th>
                      <th>{t('Code')}</th>
                      <th className="right">{t('Quantity')}</th>
                      <th className="right">{t('Reserved')}</th>
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
                  <th>{t('When')}</th>
                  <th>{t('What')}</th>
                  <th>{t('Item')}</th>
                  <th className="right">{t('Quantity')}</th>
                  <th>{t('From → to')}</th>
                  <th>{t('Ticket / note')}</th>
                  <th>{t('By')}</th>
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
