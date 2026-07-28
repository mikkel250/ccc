/**
 * Bounded async work: race a runner against a wall-clock deadline,
 * optionally linked to an external AbortSignal.
 */

export type DeadlineOptions = {
  timeoutMs: number;
  /** Used in TimeoutError / AbortError messages. */
  label: string;
  /** Caller cancellation; aborted → AbortError (not TimeoutError). */
  externalSignal?: AbortSignal;
};

function deadlineError(
  message: string,
  name: "TimeoutError" | "AbortError"
): Error {
  return Object.assign(new Error(message), { name });
}

/**
 * Run `run(signal)` until it settles or the deadline / external abort fires.
 * Already-aborted external signals reject immediately as AbortError.
 */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: DeadlineOptions
): Promise<T> {
  const { timeoutMs, label, externalSignal } = options;

  if (externalSignal?.aborted) {
    throw deadlineError(`${label} was cancelled`, "AbortError");
  }

  if (timeoutMs <= 0) {
    throw deadlineError(`${label} timed out: no budget remaining`, "TimeoutError");
  }

  const controller = new AbortController();
  let cancelledExternally = false;

  const onExternalAbort = () => {
    cancelledExternally = true;
    controller.abort();
  };

  if (externalSignal) {
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    // Abort may have raced between the initial check and listener registration.
    if (externalSignal.aborted) {
      cancelledExternally = true;
      controller.abort();
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const abortRejection = (): Error => {
    if (cancelledExternally) {
      return deadlineError(`${label} was cancelled`, "AbortError");
    }
    return deadlineError(
      `${label} timed out after ${timeoutMs}ms`,
      "TimeoutError"
    );
  };

  try {
    if (controller.signal.aborted) {
      throw abortRejection();
    }

    const runPromise = run(controller.signal);
    // Prevent unhandled rejection if the deadline wins the race first.
    void runPromise.catch(() => undefined);

    return await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(abortRejection());
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
