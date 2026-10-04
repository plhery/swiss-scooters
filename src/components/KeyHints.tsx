'use client';

import { useI18n, type TranslationKey } from '@/lib/i18n';

// The keys of src/lib/shortcuts.ts, as they are printed on a keyboard.
const HINTS: { keys: string; label: TranslationKey }[] = [
  { keys: '/', label: 'keys.search' },
  { keys: 'L', label: 'keys.nearMe' },
  { keys: '+ −', label: 'keys.zoom' },
  { keys: 'Esc', label: 'keys.close' },
];

/** The keyboard shortcuts of the desktop layout, in the bottom left corner of the map. */
export default function KeyHints() {
  const { t } = useI18n();

  return (
    <ul className="key-hints glass">
      {HINTS.map(hint => (
        <li key={hint.label}>
          <kbd>{hint.keys}</kbd>
          <span>{t(hint.label)}</span>
        </li>
      ))}
    </ul>
  );
}
