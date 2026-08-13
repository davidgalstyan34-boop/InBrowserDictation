/**
 * Creates a request AbortSignal with optional timeout and parent cancellation.
 *
 * Provider adapters use this to keep network lifecycle behavior consistent
 * without sharing provider-specific parsing or error handling.
 */
export function createRequestSignal({ parentSignal, timeoutMs }) {
  const controller = new AbortController();
  let timeoutId = null;
  let didTimeOut = false;

  const abortFromParent = () => {
    controller.abort(parentSignal.reason);
  };

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortFromParent);
      }
    }
  };
}
