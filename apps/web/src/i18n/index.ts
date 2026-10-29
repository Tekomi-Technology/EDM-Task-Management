import { useSyncExternalStore } from 'react';
import { vi } from './vi';

/**
 * Languages of the web app. The English text in the code is the source; each other language is a dictionary from
 * that text to the translation (missing entries show in English). To add a language: a new dictionary here and in
 * LANGUAGES.
 */
export const LANGUAGES = { en: 'English', vi: 'Tiếng Việt' } as const;
export type Language = keyof typeof LANGUAGES;

const DICTIONARIES: Record<Language, Record<string, string>> = { en: {}, vi };
const STORAGE_KEY = 'edm.language';
const isLanguage = (v: unknown): v is Language => typeof v === 'string' && v in LANGUAGES;

function initial(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage may be blocked; the browser's language decides.
  }
  const browser = typeof navigator === 'undefined' ? 'en' : navigator.language.slice(0, 2);
  return isLanguage(browser) ? browser : 'en';
}

let current: Language = initial();
const listeners = new Set<() => void>();

export function language(): Language {
  return current;
}

export function setLanguage(next: Language, remember = true): void {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Kept for this visit only.
    }
  }
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

/** Re-renders when the language changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}

/** The text in the current language; {name} parts are filled from vars. */
export function t(text: string, vars?: Record<string, unknown>): string {
  const s = DICTIONARIES[current][text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Locale for dates and numbers in the current language. */
export function dateLocale(): string {
  return current === 'vi' ? 'vi-VN' : 'en-GB';
}

/** A map of labels (status, type…) that answers in the current language. */
export function translated<K extends string>(labels: Record<K, string>): Record<K, string> {
  return new Proxy(labels, {
    get: (target, key) => (typeof key === 'string' && key in target ? t(target[key as K]) : undefined)
  });
}
