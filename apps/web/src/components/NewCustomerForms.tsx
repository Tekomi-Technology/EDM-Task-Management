import type {
  CustomerMatch,
  NewCustomerCard,
  OfficeConnection,
  OfficeSurvey,
  PremisesType,
  SupplyType
} from '../types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { api, ApiRequestError } from '../api';
import { PREMISES_LABEL, SUPPLY_LABEL } from '../format';
import { t } from '../i18n';
import { CustomerSearch } from './CustomerSearch';
import { LocationPicker } from './LocationPicker';
import { useMapAddress } from './mapAddress';

type Created = { id: string; code: string };
type Prospect = OfficeSurvey['customer'];

const PREMISES = Object.keys(PREMISES_LABEL) as PremisesType[];
const SUPPLIES = Object.keys(SUPPLY_LABEL) as SupplyType[];

/** Name, phone, address and place of a customer who is not known yet. */
function ProspectFields({
  value,
  onChange
}: {
  value: Prospect;
  onChange: Dispatch<SetStateAction<Prospect>>;
}) {
  // Updates from the latest state: the address from the map arrives after the point is set.
  const set = (patch: Partial<Prospect>) => onChange((p) => ({ ...p, ...patch }));
  const mapAddress = useMapAddress(value.address, (address) => set({ address }));
  return (
    <>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="nc-name">{t('Customer or company name')}</label>
          <input
            id="nc-name"
            required
            minLength={2}
            value={value.fullName}
            onChange={(e) => set({ fullName: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="nc-phone">{t('Phone for SMS (optional)')}</label>
          <input
            id="nc-phone"
            inputMode="tel"
            value={value.phone ?? ''}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="nc-address">{t('Address')}</label>
        <input
          id="nc-address"
          required
          minLength={3}
          value={value.address}
          placeholder={t('Street, landmark, neighbourhood')}
          onChange={(e) => set({ address: e.target.value })}
        />
        {mapAddress.hint}
      </div>
      <div className="field">
        <span className="label">{t('Mark the premises on the map, so the team of the area is sent')}</span>
        <LocationPicker
          value={value.location ?? null}
          onChange={(location) => {
            set({ location });
            mapAddress.placed(location);
          }}
        />
      </div>
    </>
  );
}

function SupplyAndPremises({
  premises,
  supply,
  onPremises,
  onSupply,
  premisesOptional
}: {
  premises: PremisesType | '';
  supply: SupplyType;
  onPremises: (p: PremisesType | '') => void;
  onSupply: (s: SupplyType) => void;
  premisesOptional?: boolean;
}) {
  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor="nc-premises">
          {t('Kind of premises')}
          {premisesOptional ? t(' (optional)') : ''}
        </label>
        <select
          id="nc-premises"
          required={!premisesOptional}
          value={premises}
          onChange={(e) => onPremises(e.target.value as PremisesType | '')}
        >
          <option value="">{t('Choose…')}</option>
          {PREMISES.map((p) => (
            <option key={p} value={p}>
              {PREMISES_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">{t('Supply')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('Supply')}>
          {SUPPLIES.map((s) => (
            <button key={s} type="button" aria-pressed={supply === s} onClick={() => onSupply(s)}>
              {SUPPLY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const EMPTY_PROSPECT: Prospect = { fullName: '', phone: '', address: '' };

function clean(p: Prospect): Prospect {
  return {
    fullName: p.fullName.trim(),
    phone: p.phone?.trim() || undefined,
    address: p.address.trim(),
    location: p.location ?? undefined
  };
}

/** A technical survey for a future customer, typed in by the office (nothing goes to the Sales system). */
export function SurveyForm({ onCreated }: { onCreated: (t: Created) => void }) {
  const [customer, setCustomer] = useState<Prospect>(EMPTY_PROSPECT);
  const [premises, setPremises] = useState<PremisesType | ''>('');
  const [supply, setSupply] = useState<SupplyType>('single_phase');
  const [load, setLoad] = useState('');
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<Created>('/new-customers/surveys', {
        method: 'POST',
        body: {
          customer: clean(customer),
          premises: premises as PremisesType,
          supply,
          requestedLoadKw: load ? Number(load) : undefined,
          notes: notes.trim() || undefined
        } satisfies OfficeSurvey
      }),
    onSuccess: onCreated
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form
      className="card card-pad"
      style={{ gap: 16 }}
      onSubmit={submit}
      aria-label={t('New customer survey')}
    >
      <h2 style={{ margin: 0, fontSize: 21 }}>{t('Who is the future customer?')}</h2>
      <ProspectFields value={customer} onChange={setCustomer} />
      <SupplyAndPremises premises={premises} supply={supply} onPremises={setPremises} onSupply={setSupply} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="nc-load">{t('Power asked for, in kW (optional)')}</label>
          <input
            id="nc-load"
            type="number"
            min={0.1}
            step={0.1}
            value={load}
            onChange={(e) => setLoad(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="nc-notes">{t('Notes for the surveyor (optional)')}</label>
        <textarea id="nc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="notice" style={{ margin: 0 }}>
        {t(
          'The team of the area surveys the premises. The survey closes when the report is sent; nothing is sent to the Sales system.'
        )}
      </div>
      {create.error && <div className="error">{(create.error as ApiRequestError).message}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={create.isPending}>
          {create.isPending ? t('Creating…') : t('Create ticket')}
        </button>
      </div>
    </form>
  );
}

type Basis = 'survey' | 'customer' | 'new';

/** A new connection typed in by the office. Once built, the Call Center checks it with the customer. */
export function ConnectionForm({ onCreated }: { onCreated: (t: Created) => void }) {
  const [basis, setBasis] = useState<Basis>('survey');
  const [contractNo, setContractNo] = useState('');
  const [surveyId, setSurveyId] = useState('');
  const [known, setKnown] = useState<CustomerMatch | null>(null);
  const [customer, setCustomer] = useState<Prospect>(EMPTY_PROSPECT);
  const [premises, setPremises] = useState<PremisesType | ''>('');
  const [supply, setSupply] = useState<SupplyType>('single_phase');
  const [notes, setNotes] = useState('');
  const board = useQuery({
    queryKey: ['new-customers', ''],
    queryFn: () => api<NewCustomerCard[]>('/new-customers')
  });
  const surveys = (board.data ?? []).filter((c) => c.stage === 'survey_done' && c.badgeTone !== 'bad');

  const create = useMutation({
    mutationFn: () => {
      if (basis === 'survey' && !surveyId) throw new Error(t('Choose the survey.'));
      if (basis === 'customer' && !known) throw new Error(t('Find the customer first.'));
      return api<Created>('/new-customers/connections', {
        method: 'POST',
        body: {
          contractNo: contractNo.trim(),
          surveyTicketId: basis === 'survey' ? surveyId : undefined,
          customerId: basis === 'customer' ? known!.id : undefined,
          customer: basis === 'new' ? clean(customer) : undefined,
          premises: premises || undefined,
          supply,
          notes: notes.trim() || undefined
        } satisfies OfficeConnection
      });
    },
    onSuccess: onCreated
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form className="card card-pad" style={{ gap: 16 }} onSubmit={submit} aria-label={t('New connection')}>
      <h2 style={{ margin: 0, fontSize: 21 }}>{t('Which contract and customer?')}</h2>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="nc-contract">{t('Contract number')}</label>
        <input id="nc-contract" required value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
      </div>
      <div className="segmented" role="radiogroup" aria-label={t('Customer')}>
        {(
          [
            ['survey', t('After a survey')],
            ['customer', t('Existing customer')],
            ['new', t('New customer')]
          ] as const
        ).map(([b, label]) => (
          <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>
            {label}
          </button>
        ))}
      </div>
      {basis === 'survey' && (
        <div className="field">
          <label htmlFor="nc-survey">{t('Survey done')}</label>
          <select id="nc-survey" value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {surveys.map((s) => (
              <option key={s.ticketId} value={s.ticketId}>
                {s.code} · {s.title}
                {s.place ? ` · ${s.place}` : ''}
              </option>
            ))}
          </select>
          <span className="meta">
            {surveys.length === 0
              ? t('No finished survey is waiting for a connection.')
              : t('Customer, place and the material estimate are taken from the survey.')}
          </span>
        </div>
      )}
      {basis === 'customer' &&
        (known ? (
          <div className="note" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <CheckCircle2 size={22} color="var(--brand-text)" aria-hidden />
            <div style={{ flex: 1 }}>
              <strong>{known.fullName}</strong>
              <div className="meta">{known.address}</div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setKnown(null)}>
              {t('Change')}
            </button>
          </div>
        ) : (
          <CustomerSearch onPick={setKnown} />
        ))}
      {basis === 'new' && <ProspectFields value={customer} onChange={setCustomer} />}
      <SupplyAndPremises
        premises={premises}
        supply={supply}
        onPremises={setPremises}
        onSupply={setSupply}
        premisesOptional={basis === 'survey'}
      />
      <div className="field">
        <label htmlFor="nc-cnotes">{t('Notes for the team (optional)')}</label>
        <textarea id="nc-cnotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="notice" style={{ margin: 0 }}>
        {t(
          'The team of the area builds the connection. Then the Call Center checks it with the customer, and it is closed in Closing checks.'
        )}
      </div>
      {create.error && <div className="error">{(create.error as Error).message}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={create.isPending}>
          {create.isPending ? t('Creating…') : t('Create ticket')}
        </button>
      </div>
    </form>
  );
}
