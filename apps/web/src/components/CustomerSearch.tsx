import type { CustomerMatch } from '../types';
import { useQuery } from '@tanstack/react-query';
import { Search, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';

/** Finds a customer by phone, contract or meter number (or name) while typing. */
export function CustomerSearch({ onPick }: { onPick: (c: CustomerMatch) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const results = useQuery({
    queryKey: ['customer-lookup', q],
    queryFn: () => api<CustomerMatch[]>(`/customers/lookup?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 3
  });
  return (
    <div className="field">
      <label htmlFor="caller-search">{t('Phone, contract or meter number')}</label>
      <div className="search-field" style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: 14, top: 14, color: 'var(--muted)' }} />
        <input
          id="caller-search"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('e.g. 40217735 or 84 111 0001')}
          style={{ width: '100%', paddingLeft: 42 }}
        />
      </div>
      {q.length >= 3 && results.data && (
        <div className="choices" role="group" aria-label={t('Customers found')} style={{ padding: 0 }}>
          {results.data.length === 0 && (
            <div className="meta">{t('No customer found. Check the number, or try the name.')}</div>
          )}
          {results.data.map((c) => (
            <button key={c.id} type="button" className="choice" onClick={() => onPick(c)}>
              <User size={20} aria-hidden />
              <span className="grow">
                <strong>{c.fullName}</strong>
                <div className="meta">
                  {[
                    c.contractNo && t('Contract {0}', { 0: c.contractNo }),
                    c.meterNumber && t('meter {0}', { 0: c.meterNumber }),
                    c.address,
                    c.teamName && t('team {0}', { 0: c.teamName })
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
