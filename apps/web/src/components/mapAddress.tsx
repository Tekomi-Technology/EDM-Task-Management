import { useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { t } from '../i18n';

type Point = { lat: number; lng: number };

/**
 * Fills the address from the point marked on the map, and follows the point while the address is still the one it
 * filled. Once the person types in the address it is theirs (often a landmark the map does not know): moving the
 * point then only offers the map's address under the field.
 */
export function useMapAddress(
  address: string,
  setAddress: (address: string) => void
): { placed: (p: Point) => void; hint: ReactNode } {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const filled = useRef<string | null>(null);
  const current = useRef(address);
  current.current = address;
  // Only the answer for the latest point counts when the pin is moved again before the first answer.
  const asked = useRef(0);

  const placed = async (p: Point) => {
    const n = ++asked.current;
    setLooking(true);
    let found: string | null = null;
    try {
      found = (await api<{ address: string | null }>(`/places/reverse?lat=${p.lat}&lng=${p.lng}`)).address;
    } catch {
      // No address is no problem: the person types it, as before.
    }
    if (n !== asked.current) return;
    setLooking(false);
    const own = current.current.trim() !== '' && current.current !== filled.current;
    if (!found || (own && found === current.current)) {
      setSuggestion(null);
    } else if (own) {
      setSuggestion(found);
    } else {
      filled.current = found;
      setAddress(found);
      setSuggestion(null);
    }
  };

  const take = (s: string) => {
    filled.current = s;
    setAddress(s);
    setSuggestion(null);
  };

  const hint = looking ? (
    <span className="meta">{t('Finding the address of the point…')}</span>
  ) : suggestion ? (
    <button type="button" className="link-button" onClick={() => take(suggestion)}>
      {t('Use the address of the map point: {0}', { 0: suggestion })}
    </button>
  ) : filled.current && address === filled.current ? (
    <span className="meta">{t('Filled in from the map. Add a landmark if there is one.')}</span>
  ) : null;

  return { placed: (p) => void placed(p), hint };
}
