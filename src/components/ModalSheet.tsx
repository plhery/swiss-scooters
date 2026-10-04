'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { prefersReducedMotion, selectionFeedback } from '@/lib/feedback';

interface ModalSheetProps {
  open: boolean;
  /** The heading, which also names the dialog. */
  title: string;
  /** Beside the heading, in place of "Done". */
  action?: ReactNode;
  /** Stays in view under the content, which scrolls. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** A sheet over the map: it closes with its button, Escape, a tap beside it or a pull on the grabber. */
export default function ModalSheet({ open, title, action, footer, onClose, children }: ModalSheetProps) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number; time: number } | null>(null);
  const backdropPressedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let animation: Animation | undefined;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        // It opens at the top, wherever it was left.
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
      }
      if (!prefersReducedMotion())
        animation = dialog.animate(
          [
            { opacity: 0, transform: 'translateY(32px) scale(0.98)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
    } else if (dialog.open) {
      if (prefersReducedMotion()) dialog.close();
      else {
        animation = dialog.animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(24px)' },
          ],
          { duration: 160, easing: 'ease-in', fill: 'forwards' }
        );
        animation.onfinish = () => {
          dialog.close();
          animation?.cancel();
        };
      }
    }
    return () => animation?.cancel();
  }, [open]);

  const close = () => {
    selectionFeedback();
    onClose();
  };
  const releaseDrag = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const transform = dialog.style.transform;
    dialog.style.transform = '';
    if (transform && !prefersReducedMotion())
      dialog.animate([{ transform }, { transform: 'none' }], {
        duration: 200,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
  };

  return (
    <dialog
      ref={dialogRef}
      className="control-sheet glass"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        backdropPressedRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPressedRef.current && event.target === event.currentTarget) close();
      }}
    >
      <div className="control-sheet-inner">
        <div
          className="modal-grab-area"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragRef.current = { y: event.clientY, time: performance.now() };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragRef.current || !dialogRef.current || prefersReducedMotion()) return;
            const delta = Math.max(0, event.clientY - dragRef.current.y);
            dialogRef.current.style.transform = `translateY(${delta * 0.5}px)`;
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (!drag) return;
            const delta = event.clientY - drag.y;
            const elapsed = Math.max(1, performance.now() - drag.time);
            if (delta > 70 || (delta > 20 && delta / elapsed > 0.5)) {
              if (dialogRef.current) dialogRef.current.style.transform = '';
              close();
            } else releaseDrag();
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            releaseDrag();
          }}
        >
          <span className="grabber" />
        </div>
        <header className="control-sheet-heading">
          <h2 id={titleId}>{title}</h2>
          {action ?? (
            <button type="button" className="done-button" onClick={close}>
              {t('common.done')}
            </button>
          )}
        </header>
        <div ref={bodyRef} className="control-sheet-body">
          {children}
        </div>
        {footer && <div className="control-sheet-footer">{footer}</div>}
      </div>
    </dialog>
  );
}
