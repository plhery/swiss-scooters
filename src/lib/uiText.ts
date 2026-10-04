import type { AppLocale, TranslationKey } from '@/lib/i18n';

/** A sentence and its raw values, so the logic that picks it stays free of React and locale. */
export interface UiText {
  key: TranslationKey;
  /** Substituted as they are, e.g. provider names. */
  values?: Record<string, string>;
  /** Formatted for the locale before they are substituted. */
  numbers?: Record<string, number>;
  /** Epoch milliseconds, substituted for {time} as a clock time. */
  time?: number;
}

/** The value of useI18n() satisfies this. */
export interface UiTextFormatter {
  locale: AppLocale;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
}

export function formatClockTime(time: number, locale: AppLocale): string {
  return new Date(time).toLocaleTimeString(`${locale}-CH`, { hour: '2-digit', minute: '2-digit' });
}

export function formatUiText(text: UiText, { locale, t, formatNumber }: UiTextFormatter): string {
  const values: Record<string, string | number> = { ...text.values };
  for (const [name, value] of Object.entries(text.numbers ?? {})) values[name] = formatNumber(value);
  if (text.time !== undefined) values.time = formatClockTime(text.time, locale);
  return t(text.key, values);
}
