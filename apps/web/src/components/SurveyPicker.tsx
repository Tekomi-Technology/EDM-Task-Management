import type { WaitingSurvey } from '../types';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { formatWhen, PREMISES_LABEL, qty, SUPPLY_LABEL, SURVEY_RESULT_LABEL } from '../format';
import { t } from '../i18n';

const RESULT_TONE: Record<string, string> = {
  feasible: 'ok',
  feasible_with_works: 'warn',
  not_feasible: 'late'
};

/** Shortages of the estimated material in the depot of the area. */
function shortages(s: WaitingSurvey): number {
  return s.materials.filter((m) => m.free !== null && m.free < m.needed).length;
}

/** What the survey found and what the connection would take: shown under the chosen card, read only. */
function SurveyDetails({ s }: { s: WaitingSurvey }) {
  const short = shortages(s);
  return (
    <div className="survey-details">
      <dl className="survey-facts">
        <div>
          <dt>{t('Contact')}</dt>
          <dd>{s.customer?.phone ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('Asked for')}</dt>
          <dd>
            {[s.supply && SUPPLY_LABEL[s.supply], s.requestedLoadKw !== null && `${s.requestedLoadKw} kW`]
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt>{t('On site')}</dt>
          <dd>
            {[
              s.distanceToNetworkM !== null && t('{0} m to the network', { 0: s.distanceToNetworkM }),
              s.nearestElement
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
            {s.worksNeeded && <span className="meta"> {s.worksNeeded}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('Surveyed by')}</dt>
          <dd>
            {s.surveyedBy ?? '—'}
            {s.surveyedAt ? ` · ${formatWhen(s.surveyedAt)}` : ''}
          </dd>
        </div>
        <div className="wide">
          <dt>{t('Who goes')}</dt>
          <dd>
            {s.team ? s.team.name : t('No team yet: NOC sends it to the right team.')}
            {s.assignee &&
              ` · ${t('expected: {0}', { 0: s.assignee.fullName })}${s.assignee.onDuty ? '' : ` (${t('off duty')})`}`}
          </dd>
        </div>
      </dl>
      {s.materials.length > 0 && (
        <div className="survey-stock">
          <div className="survey-stock-head">
            <strong>
              {s.depot ? t('Estimated material · {0}', { 0: s.depot.name }) : t('Estimated material')}
            </strong>
            {!s.depot ? (
              <span className="chip chip-warn">{t('No depot in this area')}</span>
            ) : short ? (
              <span className="chip chip-late">
                {t(short === 1 ? '{0} item short' : '{0} items short', { 0: short })}
              </span>
            ) : (
              <span className="chip chip-ok">{t('All in stock')}</span>
            )}
          </div>
          <ul>
            {s.materials.map((m) => {
              const missing = m.free !== null && m.free < m.needed ? m.needed - m.free : 0;
              return (
                <li key={m.itemId} className={m.free === null ? '' : missing ? 'short' : 'enough'}>
                  {m.name} · {qty(m.needed, m.unit)} ·{' '}
                  {m.free === null
                    ? t('no depot')
                    : missing
                      ? t('short of {0}', { 0: qty(missing, m.unit) })
                      : t('in stock')}
                </li>
              );
            })}
          </ul>
          {short > 0 && (
            <span className="meta">
              {t(
                'The ticket can still be made: what is in stock is set aside, the rest must come in before the job.'
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * New connection after a survey: the finished surveys waiting for a connection as cards, with a search; the chosen
 * one opens to show the customer, the result, who would go and whether the depot has the material.
 */
export function SurveyPicker({
  value,
  onChange
}: {
  value: WaitingSurvey | null;
  onChange: (s: WaitingSurvey | null) => void;
}) {
  const [search, setSearch] = useState('');
  const surveys = useQuery({
    queryKey: ['waiting-surveys'],
    queryFn: () => api<WaitingSurvey[]>('/new-customers/surveys/waiting')
  });
  const words = search.trim().toLowerCase();
  const list = (surveys.data ?? []).filter(
    (s) =>
      !words ||
      [s.code, s.customer?.fullName, s.customer?.phone, s.customer?.address]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(words))
  );
  if (surveys.isLoading) return <div className="meta">{t('Loading…')}</div>;
  if (!surveys.data?.length)
    return <div className="notice">{t('No finished survey is waiting for a connection.')}</div>;
  return (
    <div className="survey-picker">
      <div className="search-box">
        <Search size={16} aria-hidden />
        <input
          aria-label={t('Find a survey')}
          placeholder={t('Ticket code, customer name or phone')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <span className="meta">
        {t(
          surveys.data.length === 1
            ? '{0} finished survey is waiting for a connection'
            : '{0} finished surveys are waiting for a connection',
          { 0: surveys.data.length }
        )}
      </span>
      <div className="survey-cards" role="radiogroup" aria-label={t('Survey done')}>
        {list.map((s) => {
          const picked = value?.ticketId === s.ticketId;
          return (
            <div key={s.ticketId} className={`survey-card${picked ? ' picked' : ''}`}>
              <button
                type="button"
                role="radio"
                aria-checked={picked}
                className="survey-card-head"
                onClick={() => onChange(picked ? null : s)}
              >
                <span className="survey-radio" aria-hidden="true" />
                <span className="survey-card-text">
                  <strong>
                    {s.customer?.fullName ?? s.code}
                    {s.premises ? ` · ${PREMISES_LABEL[s.premises]}` : ''}
                  </strong>
                  <span className="meta">
                    {s.code}
                    {s.customer?.address ? ` · ${s.customer.address}` : ''}
                  </span>
                </span>
                <span className={`chip chip-${RESULT_TONE[s.result] ?? 'ok'}`}>
                  {SURVEY_RESULT_LABEL[s.result]}
                </span>
              </button>
              {picked && <SurveyDetails s={s} />}
            </div>
          );
        })}
        {list.length === 0 && <div className="meta">{t('No survey matches.')}</div>}
      </div>
    </div>
  );
}
