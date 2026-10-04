import type { TranslationKey } from '@/lib/i18n';

/** Why scooters could not be loaded. The same five reasons exist on iOS. */
export type LoadFailure = 'offline' | 'timeout' | 'busy' | 'unavailable' | 'failed';

export interface LoadFailureInput {
  /** The HTTP status, when the server answered with an error. */
  status?: number;
  /** The request ran into its deadline. */
  timedOut?: boolean;
  /** navigator.onLine when the request failed. */
  online?: boolean;
}

export function classifyLoadFailure({ status, timedOut = false, online = true }: LoadFailureInput): LoadFailure {
  if (status !== undefined) {
    if (status === 429) return 'busy';
    return status >= 500 && status <= 599 ? 'unavailable' : 'failed';
  }
  // A request that stalls because the connection dropped is "offline", not slow.
  if (!online) return 'offline';
  return timedOut ? 'timeout' : 'failed';
}

const REASON_KEYS = {
  offline: 'fail.offline',
  timeout: 'fail.timeout',
  busy: 'fail.busy',
  unavailable: 'fail.unavailable',
  failed: 'fail.generic',
} as const satisfies Record<LoadFailure, TranslationKey>;

/** The sentence that explains the failure in the banner and the out-of-date card. */
export function failureReasonKey(failure: LoadFailure): TranslationKey {
  return REASON_KEYS[failure];
}

export type FailureSurface = 'banner' | 'status' | 'card';

/**
 * Where a failure is shown: the banner under the search bar while nothing has
 * loaded, the dock status line while the data on screen is still valid, the
 * out-of-date card once it is not. Never a toast.
 */
export function failureSurface(state: {
  failure: LoadFailure | null;
  hasData: boolean;
  outOfDate: boolean;
}): FailureSurface | null {
  if (state.outOfDate) return 'card';
  if (!state.failure) return null;
  return state.hasData ? 'status' : 'banner';
}
