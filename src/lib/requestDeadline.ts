/** A disposable deadline covers the response body as well as the initial fetch. */
export function requestDeadline(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent.removeEventListener('abort', abort); },
  };
}
