'use client';

import { useState } from 'react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { locationHelp } from '@/lib/locationHelp';
import ModalSheet from './ModalSheet';

interface LocationHelpSheetProps {
  open: boolean;
  onClose: () => void;
}

/** How to turn location back on after it was refused: the steps for this browser and this device. */
export default function LocationHelpSheet({ open, onClose }: LocationHelpSheetProps) {
  const { t } = useI18n();
  // Worked out when the sheet first opens: the server does not know the browser.
  const [steps, setSteps] = useState<TranslationKey[] | null>(null);
  if (open && !steps) setSteps(locationHelp(navigator.userAgent, navigator.maxTouchPoints).steps);

  return (
    <ModalSheet open={open} title={t('help.title')} onClose={onClose}>
      {/* Without bullets a list is not announced as one everywhere: the role says it again, and the numbers are read. */}
      <ol className="help-steps" role="list">
        {steps?.map((step, index) => (
          <li key={step}>
            <span className="help-step-number">{index + 1}</span>
            <span>{t(step)}</span>
          </li>
        ))}
      </ol>
      <p className="help-after">{t('help.after')}</p>
    </ModalSheet>
  );
}
