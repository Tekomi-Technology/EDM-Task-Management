import type {
  CustomerMatch,
  OfficeConnection,
  OfficeSurvey,
  PlaceTeam,
  PremisesType,
  SupplyType,
  WaitingSurvey
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
import { SurveyPicker } from './SurveyPicker';
import { TeamChoice, teamChoiceBody, type TeamPick } from './TeamChoice';

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

/** The team of the area a point falls in, once the point is marked. */
function usePlaceTeam(location: { lat: number; lng: number } | null | undefined): string | null {
  const place = useQuery({
    queryKey: ['place-team', location?.lat, location?.lng],
    queryFn: () => api<PlaceTeam>(`/places/team?lat=${location!.lat}&lng=${location!.lng}`),
    enabled: !!location
  });
  return place.data?.team?.name ?? null;
}

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
  const [team, setTeam] = useState<TeamPick | null>(null);
  const placeTeam = usePlaceTeam(customer.location);
  const create = useMutation({
    mutationFn: () =>
      api<Created>('/new-customers/surveys', {
        method: 'POST',
        body: {
          customer: clean(customer),
          premises: premises as PremisesType,
          supply,
          requestedLoadKw: load ? Number(load) : undefined,
          notes: notes.trim() || undefined,
          ...teamChoiceBody(team)
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
      <TeamChoice autoTeamName={placeTeam} value={team} onChange={setTeam} />
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
  const [picked, setPicked] = useState<WaitingSurvey | null>(null);
  /** After a survey the premises and supply surveyed are kept, unless the contract differs. */
  const [changeKind, setChangeKind] = useState(false);
  const [known, setKnown] = useState<CustomerMatch | null>(null);
  const [customer, setCustomer] = useState<Prospect>(EMPTY_PROSPECT);
  const [premises, setPremises] = useState<PremisesType | ''>('');
  const [supply, setSupply] = useState<SupplyType>('single_phase');
  const [notes, setNotes] = useState('');
  const [team, setTeam] = useState<TeamPick | null>(null);
  const newPlaceTeam = usePlaceTeam(basis === 'new' ? customer.location : null);
  const keepSurveyed = basis === 'survey' && !changeKind;

  const create = useMutation({
    mutationFn: () => {
      if (basis === 'survey' && !picked) throw new Error(t('Choose the survey.'));
      if (basis === 'customer' && !known) throw new Error(t('Find the customer first.'));
      return api<Created>('/new-customers/connections', {
        method: 'POST',
        body: {
          contractNo: contractNo.trim(),
          surveyTicketId: basis === 'survey' ? picked!.ticketId : undefined,
          customerId: basis === 'customer' ? known!.id : undefined,
          customer: basis === 'new' ? clean(customer) : undefined,
          premises: keepSurveyed ? undefined : premises || undefined,
          supply: keepSurveyed ? undefined : supply,
          notes: notes.trim() || undefined,
          ...teamChoiceBody(team)
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
      <h2 style={{ margin: 0, fontSize: 21 }}>{t('Who is the connection for?')}</h2>
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
        <SurveyPicker
          value={picked}
          onChange={(survey) => {
            setPicked(survey);
            setChangeKind(false);
          }}
        />
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
      <h2 style={{ margin: '4px 0 0', fontSize: 18 }}>{t('Contract')}</h2>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="nc-contract">{t('Contract number')}</label>
        <input
          id="nc-contract"
          required
          value={contractNo}
          placeholder={t('e.g. HD-2026-0153')}
          onChange={(e) => setContractNo(e.target.value)}
        />
      </div>
      {keepSurveyed ? (
        picked && (
          <div className="field">
            <span className="label">{t('Premises and supply')}</span>
            <div className="btn-row" style={{ alignItems: 'center' }}>
              <strong>
                {[
                  picked.premises && PREMISES_LABEL[picked.premises],
                  picked.supply && SUPPLY_LABEL[picked.supply]
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </strong>
              <span className="meta">{t('as surveyed')}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setPremises(picked.premises ?? '');
                  setSupply(picked.supply ?? 'single_phase');
                  setChangeKind(true);
                }}
              >
                {t('Change')}
              </button>
            </div>
          </div>
        )
      ) : (
        <SupplyAndPremises
          premises={premises}
          supply={supply}
          onPremises={setPremises}
          onSupply={setSupply}
          premisesOptional={basis === 'survey'}
        />
      )}
      <div className="field">
        <label htmlFor="nc-cnotes">{t('Notes for the team (optional)')}</label>
        <textarea id="nc-cnotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <TeamChoice
        autoTeamName={
          basis === 'customer'
            ? (known?.teamName ?? null)
            : basis === 'new'
              ? newPlaceTeam
              : (picked?.team?.name ?? null)
        }
        value={team}
        onChange={setTeam}
      />
      <div className="notice" style={{ margin: 0 }}>
        {t(
          'The team of the area builds the connection. Then the Call Center, NOC or an administrator checks it with the customer and closes it in Closing checks.'
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
