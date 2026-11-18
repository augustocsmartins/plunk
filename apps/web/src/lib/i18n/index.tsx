import {setUiTranslator} from '@plunk/ui';
import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';
import React, {useEffect} from 'react';
import {z} from 'zod';

import ptBR from './locales/pt-BR.json';
import {ptBRZodErrorMap} from './zod';

/**
 * Dashboard translations.
 *
 * The English source text is the translation key (gettext style): `t('Save changes')`.
 * Untranslated strings fall back to English, so upstream changes keep working before they are
 * translated, and diffs against upstream stay limited to wrapping strings in `t()`.
 *
 * Placeholders use `{name}`: `t('{count} contacts', {count: 3})`.
 *
 * The locale is read once when the module loads (so module-level constants such as tab labels
 * are translated too) and changing it reloads the page.
 */

export type Locale = 'pt-BR' | 'en';

export const DEFAULT_LOCALE: Locale = 'pt-BR';

export const SUPPORTED_LOCALES: Array<{code: Locale; label: string}> = [
  {code: 'pt-BR', label: 'Português (Brasil)'},
  {code: 'en', label: 'English'},
];

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  'pt-BR': ptBR as Record<string, string>,
  'en': {},
};

const DAYJS_LOCALES: Record<Locale, string> = {
  'pt-BR': 'pt-br',
  'en': 'en',
};

const STORAGE_KEY = 'plunk.locale';

export type TranslateVars = Record<string, string | number | null | undefined>;
export type TranslateFn = (source: string, vars?: TranslateVars) => string;

function isLocale(value: unknown): value is Locale {
  return value === 'pt-BR' || value === 'en';
}

function readStoredLocale(): Locale {
  // Tests assert the English source strings
  if (typeof process !== 'undefined' && process.env.VITEST) return 'en';
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage unavailable (private mode): keep the default
  }
  return DEFAULT_LOCALE;
}

const currentLocale: Locale = readStoredLocale();
dayjs.locale(DAYJS_LOCALES[currentLocale]);

function interpolate(text: string, vars?: TranslateVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Translate an English source string into the active locale. */
export const t: TranslateFn = (source, vars) => interpolate(DICTIONARIES[currentLocale][source] ?? source, vars);

setUiTranslator(source => t(source));
if (currentLocale === 'pt-BR') z.setErrorMap(ptBRZodErrorMap);

/** Active locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/** BCP 47 tag for Intl / toLocale* calls. */
export function getIntlLocale(): string {
  return currentLocale;
}

/** Persist the choice and reload so every screen (and module-level label) picks it up. */
export function setLocale(next: Locale): void {
  if (next === currentLocale) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore: nothing to persist to
  }
  window.location.reload();
}

export function useTranslation(): {t: TranslateFn; locale: Locale; setLocale: (next: Locale) => void} {
  return {t, locale: currentLocale, setLocale};
}

/** Keeps <html lang> in sync with the active locale. */
export function I18nProvider({children}: {children: React.ReactNode}) {
  useEffect(() => {
    document.documentElement.lang = currentLocale;
  }, []);

  return <>{children}</>;
}
