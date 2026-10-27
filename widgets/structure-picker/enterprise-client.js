import {
  EXTERNAL_LIMIT,
  buildOfficialTextSearchRequest,
  extractOfficialCandidates,
} from "./search.js";
import { abortable, boundedSource, emitTrace } from "./bounded-source.js";

const MIN_REQUEST_INTERVAL_MS = 1800;
const DEFAULT_CACHE_TTL_MS = 20 * 60 * 1000;
const CACHE_PREFIX = "structure-assistant:annuaire:v3:";

let lastRequestAt = 0;
let backoffUntil = 0;
let queue = Promise.resolve();

function storageAvailable() {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function cacheKey(request) {
  return `${CACHE_PREFIX}${request?.cacheKey || request?.url || ""}`;
}

function readCache(request, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (ttlMs <= 0 || !storageAvailable()) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(request));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.at || !entry?.value || Date.now() - entry.at > ttlMs) {
      sessionStorage.removeItem(cacheKey(request));
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

function writeCache(request, value, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (ttlMs <= 0 || !storageAvailable()) return;
  try {
    sessionStorage.setItem(cacheKey(request), JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Le cache est une optimisation uniquement.
  }
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(response) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return 5000;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 5000;
}

async function takeQueueSlot(signal) {
  let release;
  const previous = queue;
  const ownSlot = new Promise(resolve => { release = resolve; });
  queue = previous.then(() => ownSlot);
  try {
    await abortable(previous, signal);
    const now = Date.now();
    const intervalWait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - now);
    const backoffWait = Math.max(0, backoffUntil - now);
    await wait(Math.max(intervalWait, backoffWait), signal);
    if (signal?.aborted) throw abortError();
    lastRequestAt = Date.now();
  } finally {
    release();
  }
}

export async function fetchOfficialRequest(request, {
  signal,
  fetchImpl = fetch,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  localIdentifiers = new Set(),
  limit,
  allowSiegeFallback = false,
  timeoutMs = 6500,
  onEvent,
} = {}) {
  if (!request?.url) throw new Error("Requête Annuaire invalide.");
  const cached = readCache(request, cacheTtlMs);
  if (cached) {
    emitTrace(onEvent, { source: "annuaire:cache", state: "ok", url: request.url, elapsedMs: 0 });
    return { ...cached, cached: true };
  }

  return boundedSource("annuaire:request", async requestSignal => {
    const queuedAt = Date.now();
    emitTrace(onEvent, { source: "annuaire:queue", state: "start", url: request.url });
    if (backoffUntil - Date.now() >= timeoutMs) {
      const error = new Error("Annuaire temporairement limité : reprise après le budget de cette analyse.");
      error.code = "RATE_LIMIT"; error.retryAfterMs = backoffUntil - Date.now(); throw error;
    }
    await takeQueueSlot(requestSignal);
    emitTrace(onEvent, { source: "annuaire:queue", state: "ok", url: request.url, elapsedMs: Date.now() - queuedAt });
    if (requestSignal.aborted) throw abortError();

    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: requestSignal,
    });
    if (response.status === 429) {
      const delay = retryDelayMs(response);
      backoffUntil = Date.now() + delay;
      const error = new Error(`L'Annuaire limite temporairement les requêtes. Réessaie dans ${Math.ceil(delay / 1000)} s.`);
      error.code = "RATE_LIMIT";
      error.retryAfterMs = delay;
      throw error;
    }
    if (!response.ok) throw new Error(`Recherche Annuaire indisponible (HTTP ${response.status}).`);

    const payload = await response.json();
    if (requestSignal.aborted) throw abortError();
    const extracted = extractOfficialCandidates(payload, {
      localIdentifiers,
      limit: limit ?? (allowSiegeFallback ? EXTERNAL_LIMIT : undefined),
      requestedSiret: request.requestedSiret ?? "",
      allowSiegeFallback,
      page: request.page ?? 1,
      perPage: request.perPage ?? 25,
      matchingLimit: request.matchingLimit ?? 100,
    });
    const value = { items: extracted.items, coverage: extracted.coverage };
    writeCache(request, value, cacheTtlMs);
    return { ...value, cached: false };
  }, { signal, timeoutMs, onEvent });
}

export async function fetchExternalText(query, {
  signal,
  codePostal = "",
  perPage = 10,
  matchingLimit = 10,
  limit = EXTERNAL_LIMIT,
  fetchImpl = fetch,
} = {}) {
  const request = buildOfficialTextSearchRequest(query, { codePostal, perPage, matchingLimit });
  if (!request) return { items: [], coverage: { complete: true }, cached: false };
  return fetchOfficialRequest(request, {
    signal,
    fetchImpl,
    limit,
    allowSiegeFallback: true,
  });
}

export function resetOfficialClientForTests() {
  lastRequestAt = 0;
  backoffUntil = 0;
  queue = Promise.resolve();
}
