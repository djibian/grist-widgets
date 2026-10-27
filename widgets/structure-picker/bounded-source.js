// Every wait (including a queue or a source ignoring AbortSignal) belongs to a
// named, finite operation. Cancellation never waits for the transport to settle.
export function abortException(signal) {
  return signal?.reason?.name === "TimeoutError" ? signal.reason : new DOMException("Aborted", "AbortError");
}

export async function abortable(promise, signal) {
  if (signal?.aborted) throw abortException(signal);
  let cancel;
  const aborted = new Promise((resolve, reject) => {
    cancel = () => reject(abortException(signal));
    signal?.addEventListener("abort", cancel, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal?.removeEventListener("abort", cancel); }
}

export function emitTrace(callback, event) {
  if (typeof callback !== "function") return;
  try { callback(event); } catch { /* Diagnostics cannot change a decision. */ }
}

export async function boundedSource(source, operation, { signal, timeoutMs = 4000, onEvent } = {}) {
  if (signal?.aborted) throw abortException(signal);
  const controller = new AbortController();
  const startedAt = Date.now();
  const forward = () => controller.abort(abortException(signal));
  signal?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(`${source} : budget de ${timeoutMs} ms écoulé`, "TimeoutError")), Math.max(1, timeoutMs));
  emitTrace(onEvent, { source, state: "start", startedAt, budgetMs: timeoutMs });
  try {
    const value = await abortable(Promise.resolve().then(() => {
      if (controller.signal.aborted) throw abortException(controller.signal);
      return operation(controller.signal);
    }), controller.signal);
    emitTrace(onEvent, { source, state: "ok", elapsedMs: Date.now() - startedAt, budgetMs: timeoutMs });
    return value;
  } catch (error) {
    emitTrace(onEvent, { source, state: error?.name === "TimeoutError" ? "timeout" : controller.signal.aborted ? "aborted" : "error",
      elapsedMs: Date.now() - startedAt, budgetMs: timeoutMs, message: error.message });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
    controller.abort(new DOMException("Source terminée", "AbortError"));
  }
}
