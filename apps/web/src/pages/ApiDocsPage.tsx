import type {
  IntegrationDocField,
  IntegrationDocOperation,
  IntegrationDocs,
  IntegrationDocSystem,
  IntegrationSystem
} from '../types';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useCrumbs } from '../components/ui';
import { t, translated } from '../i18n';

const SYSTEM_NAME = translated<IntegrationSystem>({
  call_center: 'Call Center',
  sales: 'Sales system',
  nms: 'Network management (NMS)',
  stock: 'Stock management',
  sms: 'SMS gateway',
  push: 'Push notifications'
});

const TYPE_LABEL = translated({
  string: 'text',
  number: 'number',
  integer: 'whole number',
  boolean: 'true / false',
  object: 'group of fields',
  array: 'list',
  any: 'any'
});

const WHERE_LABEL = translated({ path: 'in the address', query: 'in the query', body: 'in the body' });

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? t('Copied') : t('Copy')}
    </button>
  );
}

function Code({ text, label }: { text: string; label: string }) {
  return (
    <div className="code-block">
      <div className="code-copy">
        <CopyButton text={text} label={label} />
      </div>
      <pre>{text}</pre>
    </div>
  );
}

/** "1–64 characters", "up to 2000 characters", "-90 to 90", "1–500 items". */
function limits(f: IntegrationDocField): string | null {
  const { min, max } = f;
  if (min === null && max === null) return null;
  const pick = (both: string, upTo: string, atLeast: string) =>
    min !== null && max !== null
      ? t(both, { 0: min, 1: max })
      : max !== null
        ? t(upTo, { 0: max })
        : t(atLeast, { 0: min });
  if (f.type === 'string')
    return pick('{0}–{1} characters', 'up to {0} characters', 'at least {0} characters');
  if (f.type === 'array') return pick('{0}–{1} items', 'up to {0} items', 'at least {0} items');
  if (f.minExclusive)
    return max !== null ? t('above {0}, at most {1}', { 0: min, 1: max }) : t('above {0}', { 0: min });
  return pick('{0} to {1}', 'at most {0}', 'at least {0}');
}

function FieldRow({ f }: { f: IntegrationDocField }) {
  const depth = f.name.split('.').length - 1;
  const rule = limits(f);
  return (
    <tr>
      <td style={{ paddingLeft: 24 + depth * 16 }}>
        <code className="field-name">{f.name}</code>
        {f.in !== 'body' && <div className="meta">{WHERE_LABEL[f.in]}</div>}
      </td>
      <td>
        {TYPE_LABEL[f.type as keyof typeof TYPE_LABEL] ?? f.type}
        {f.format === 'date-time' && <div className="meta">{t('date and time, ISO 8601')}</div>}
      </td>
      <td>{f.required ? <span className="badge badge-brand">{t('Required')}</span> : t('Optional')}</td>
      <td className="wrap">
        {f.description && <div>{t(f.description)}</div>}
        {f.values && (
          <div className="api-values">
            {f.values.map((v) => (
              <code key={v}>{v}</code>
            ))}
          </div>
        )}
        {rule && <div className="meta">{rule}</div>}
      </td>
    </tr>
  );
}

function Operation({ op }: { op: IntegrationDocOperation }) {
  return (
    <section className="card" aria-label={`${op.method} ${op.path}`}>
      <div className="card-pad" style={{ gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`method method-${op.method.toLowerCase()}`}>{op.method}</span>
          <code className="api-path">{op.path}</code>
          <CopyButton text={op.path} label={t('Copy the address')} />
        </div>
        <h3 style={{ margin: 0, fontSize: 17 }}>{t(op.summary)}</h3>
        {op.description && <p style={{ margin: 0 }}>{t(op.description)}</p>}
      </div>
      {op.fields.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Field name')}</th>
                <th>{t('Type')}</th>
                <th>{t('Required?')}</th>
                <th>{t('Meaning')}</th>
              </tr>
            </thead>
            <tbody>
              {op.fields.map((f) => (
                <FieldRow key={`${f.in}-${f.name}`} f={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {op.example !== null && (
        <details className="api-example">
          <summary>{t('Example of what to send')}</summary>
          <Code text={JSON.stringify(op.example, null, 2)} label={t('Copy the example')} />
        </details>
      )}
    </section>
  );
}

const API_URL = `${import.meta.env.VITE_API_URL ?? window.location.origin}`;

function SignIn({ system }: { system: IntegrationDocSystem }) {
  const op = system.operations.find((o) => o.method !== 'GET') ?? system.operations[0];
  const curl = op
    ? [
        `curl -X ${op.method} ${API_URL}${op.path} \\`,
        `  -H "Authorization: Bearer edm_…" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${JSON.stringify(op.example ?? {})}'`
      ].join('\n')
    : '';
  return (
    <section className="card card-pad" style={{ gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{t('Signing in')}</h2>
      <p style={{ margin: 0 }}>
        {t('The system sends its API key with every request, in the header')}{' '}
        <code>Authorization: Bearer &lt;key&gt;</code>.{' '}
        {t("Each system has its own keys; a key only opens that system's routes below.")}
      </p>
      <div className="meta">
        {t('An administrator makes and revokes the keys in')}{' '}
        <Link to="/admin/api-keys">{t('Administration → API keys')}</Link>.{' '}
        {t('A key is shown only once, when it is made.')}
      </div>
      {curl && <Code text={curl} label={t('Copy the command')} />}
    </section>
  );
}

function Webhooks({ system }: { system: IntegrationDocSystem }) {
  if (system.webhooks.length === 0) return null;
  return (
    <section className="card">
      <div className="card-pad" style={{ gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('What EDM Tasks sends back')}</h2>
        <p style={{ margin: 0 }}>
          {t('EDM Tasks posts each event to the address set in')} <code>SALES_WEBHOOK_URL</code>.{' '}
          {t('The header')} <code>X-EDM-Event</code> {t('names the event and')} <code>X-EDM-Signature</code>{' '}
          {t('is')} <code>sha256=&lt;HMAC&gt;</code> {t('of the body, signed with')}{' '}
          <code>SALES_WEBHOOK_SECRET</code>.{' '}
          {t('Answer 2xx when received. On 5xx or no answer it is sent again; on 4xx it is not.')}
        </p>
      </div>
      {system.webhooks.map((w) => (
        <div key={w.event} className="card-pad" style={{ gap: 8, borderTop: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="method method-post">POST</span>
            <code className="api-path">{w.event}</code>
          </div>
          <div>{t(w.description)}</div>
          <details className="api-example" style={{ margin: 0 }}>
            <summary>{t('Example')}</summary>
            <Code text={JSON.stringify(w.example, null, 2)} label={t('Copy the example')} />
          </details>
        </div>
      ))}
    </section>
  );
}

/** What the other EDM systems can call, built by the API from its own description. */
export function ApiDocsPage() {
  useCrumbs([{ label: t('Administration') }, { label: t('API documentation') }]);
  const [params, setParams] = useSearchParams();
  const docs = useQuery({
    queryKey: ['integration-docs'],
    queryFn: () => api<IntegrationDocs>('/integrations/docs'),
    staleTime: Infinity
  });
  const d = docs.data;
  const current = d?.systems.find((s) => s.system === params.get('system')) ?? d?.systems[0];
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('API documentation')}</h1>
          <div className="subtitle">
            {t(
              'The APIs the other EDM systems call to send work here, and what EDM Tasks sends back. Read from the running API, so it always matches it.'
            )}
          </div>
        </div>
      </div>
      {docs.error && <div className="error">{(docs.error as Error).message}</div>}
      {d && current && (
        <>
          <div className="segmented" role="tablist" aria-label={t('System')}>
            {d.systems.map((s) => (
              <button
                key={s.system}
                type="button"
                role="tab"
                aria-selected={s.system === current.system}
                aria-pressed={s.system === current.system}
                onClick={() => setParams({ system: s.system }, { replace: true })}
              >
                {SYSTEM_NAME[s.system]} · {s.operations.length}
              </button>
            ))}
          </div>
          <SignIn system={current} />
          {current.operations.map((op) => (
            <Operation key={`${op.method} ${op.path}`} op={op} />
          ))}
          <Webhooks system={current} />
        </>
      )}
    </div>
  );
}
