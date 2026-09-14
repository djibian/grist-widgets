import { allThePlacesContactSource } from "./contact-sources/all-the-places.js";
import { dilaContactSource } from "./contact-sources/dila.js";
import { osmContactSource } from "./contact-sources/osm.js";
import { overtureContactSource } from "./contact-sources/overture.js";
import { wikidataContactSource } from "./contact-sources/wikidata.js";

export const CONTACT_SOURCES = Object.freeze([
  osmContactSource,
  dilaContactSource,
  wikidataContactSource,
  allThePlacesContactSource,
  overtureContactSource,
]);

export function availableContactSources(context, sources = CONTACT_SOURCES) {
  return Object.freeze((Array.isArray(sources) ? sources : []).filter(source => source?.canSearch?.(context)));
}

function sourceState(source, status, candidateCount = 0, error = null) {
  return Object.freeze({
    id: String(source?.id ?? ""),
    label: String(source?.label ?? source?.id ?? "Source publique"),
    status,
    candidateCount,
    error,
  });
}

export async function searchContactSources(context = {}, options = {}) {
  const sources = availableContactSources(context, options.sources ?? CONTACT_SOURCES);
  const signal = options.signal;
  const sourceOptions = options.sourceOptions ?? {};

  const settled = await Promise.allSettled(sources.map(source => source.search(context, {
    ...sourceOptions,
    signal,
  })));

  const candidates = [];
  const states = [];

  settled.forEach((entry, index) => {
    const source = sources[index];
    if (entry.status === "fulfilled") {
      const sourceCandidates = Array.isArray(entry.value?.candidates) ? entry.value.candidates : [];
      candidates.push(...sourceCandidates);
      states.push(sourceState(source, "success", sourceCandidates.length));
      return;
    }

    if (entry.reason?.name === "AbortError") throw entry.reason;
    states.push(sourceState(source, "error", 0, entry.reason instanceof Error ? entry.reason.message : String(entry.reason ?? "Erreur inconnue")));
  });

  return Object.freeze({
    sources,
    states: Object.freeze(states),
    candidates: Object.freeze(candidates),
  });
}
