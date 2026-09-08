/** Short, rate-limited feedback for deliberate interactions only. */
let lastFeedbackAt = -Infinity;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
}

export function selectionFeedback() {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.vibrate !== 'function' ||
    prefersReducedMotion() ||
    document.visibilityState === 'hidden'
  )
    return;

  const now = performance.now();
  if (now - lastFeedbackAt < 70) return;
  lastFeedbackAt = now;
  try {
    navigator.vibrate(8);
  } catch {
    /* Feedback is optional. */
  }
}
