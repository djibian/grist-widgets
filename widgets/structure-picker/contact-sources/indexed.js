import {
  CONTACT_MATCH_KINDS,
  createContactCandidate,
} from "../contact-model.js";
import {
  CONTACT_INDEX_MANIFEST_URL,
  loadContactIndexManifest,
  loadContactIndexShard,
  resolveContactIndexShard,
} from "../contact-indexes.js";
import {
  compareContactCandidates,
  contactMatchEvidence,
} from "../contact-ranking.js";
import { departmentFromPostalCode } from "../departments.js";
import {
  extractLocationFromAddress,
  normalize,
} from "../search.js";

const MAX_RECORD_VARIANTS = 4;
const MAX_SOURCE_CANDIDATES = 16;

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasCoordinate(value) {
  return finite(value) !== null;
}

function uniqueContacts(primary, values) {
  return [...new Set([primary, ...(Array.isArray(values) ? values : [])]
    .map(clean)
    .filter(Boolean))];
}

function contactVariants(record = {}) {
  const telephones = uniqueContacts(record.telephone, record.telephones);
  const courriels = uniqueContacts(record.courriel, record.courriels);
  const sitesWeb = uniqueContacts(record.siteWeb, record.sitesWeb);
  const base = Object.freeze({
    telephone: telephones[0] || "",
    courriel: courriels[0] || "",
    siteWeb: sitesWeb[0] || "",
  });
  const variants = [];
  const seen = new Set();

  const add = contacts => {
    if (variants.length >= MAX_RECORD_VARIANTS) return;
    const key = [contacts.telephone, contacts.courriel, contacts.siteWeb].join("\u0000");
    if (!key.replaceAll("\u0000", "") || seen.has(key)) return;
    seen.add(key);
    variants.push(Object.freeze({ ...contacts }));
  };

  add(base);
  for (const telephone of telephones.slice(1)) add({ ...base, telephone });
  for (const courriel of courriels.slice(1)) add({ ...base, courriel });
  for (const siteWeb of sitesWeb.slice(1)) add({ ...base, siteWeb });
  return variants;
}

function indexedLocation(context = {}) {
  const { codePostal } = extractLocationFromAddress(context.address);
  const postcode = /^\d{5}$/.test(codePostal) ? codePostal : "";
  const department = postcode ? departmentFromPostalCode(postcode) : "";
  return Object.freeze({ postcode, department });
}

export function canSearchIndexedContext(context = {}) {
  const location = indexedLocation(context);
  if (!location.postcode || !location.department) return false;
  const name = normalize(context.name);
  const address = normalize(context.address);
  const siret = clean(context.siret).replace(/\D/g, "");
  return Boolean(
    siret.length === 14
    || name.length >= 2
    || address.length > location.postcode.length
    || (hasCoordinate(context.latitude) && hasCoordinate(context.longitude)),
  );
}

function initialCandidate(config, record, contacts) {
  return createContactCandidate({
    source: {
      id: config.id,
      label: config.label,
      recordType: typeof config.recordType === "function" ? config.recordType(record) : config.recordType,
      recordId: record?.recordId,
      provenance: typeof config.provenance === "function" ? config.provenance(record) : [],
    },
    identity: {
      name: record?.name,
      siret: record?.siret,
      address: record?.address,
      latitude: record?.latitude,
      longitude: record?.longitude,
    },
    contacts,
    match: {
      kind: CONTACT_MATCH_KINDS.UNKNOWN,
      score: typeof config.score === "function" ? config.score(record) : null,
    },
  });
}

function withMatchEvidence(candidate, context) {
  const evidence = contactMatchEvidence(candidate, context);
  const kind = evidence.exactSiret
    ? CONTACT_MATCH_KINDS.EXACT_SIRET
    : (evidence.hasCoordinateEvidence && evidence.distanceMeters <= 300 && evidence.nameScore >= 0.55
      ? CONTACT_MATCH_KINDS.NEARBY_NAME
      : CONTACT_MATCH_KINDS.UNKNOWN);

  return createContactCandidate({
    source: candidate.source,
    identity: candidate.identity,
    contacts: candidate.contacts,
    match: {
      ...candidate.match,
      kind,
      nameScore: evidence.nameScore,
      distanceMeters: evidence.distanceMeters,
    },
  });
}

function isUsefulCandidate(candidate, context) {
  const evidence = contactMatchEvidence(candidate, context);
  return Boolean(
    evidence.exactSiret
    || evidence.exactAddress
    || evidence.nameScore >= 0.45
    || (evidence.hasCoordinateEvidence && evidence.distanceMeters <= 500 && evidence.nameScore >= 0.30),
  );
}

function candidatesFromShard(config, shard, context) {
  const candidates = [];
  for (const record of shard?.records ?? []) {
    for (const contacts of contactVariants(record)) {
      const candidate = withMatchEvidence(initialCandidate(config, record, contacts), context);
      if (isUsefulCandidate(candidate, context)) candidates.push(candidate);
    }
  }
  return candidates
    .sort((left, right) => compareContactCandidates(left, right, context))
    .slice(0, MAX_SOURCE_CANDIDATES);
}

export function createIndexedContactSource(config = {}) {
  const id = clean(config.id);
  const label = clean(config.label) || id;
  if (!id) throw new Error("Une source indexée doit avoir un identifiant.");

  return Object.freeze({
    id,
    label,

    canSearch(context = {}) {
      return canSearchIndexedContext(context);
    },

    async search(context = {}, options = {}) {
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      const manifestUrl = options.manifestUrl ?? CONTACT_INDEX_MANIFEST_URL;
      const manifest = options.manifest ?? await loadContactIndexManifest({
        fetchImpl,
        url: manifestUrl,
        signal: options.signal,
      });
      const location = indexedLocation(context);
      const entry = resolveContactIndexShard(manifest, id, location, { manifestUrl });
      if (!entry) {
        return Object.freeze({
          source: Object.freeze({ id, label }),
          candidates: Object.freeze([]),
        });
      }

      const shard = await loadContactIndexShard(entry, {
        fetchImpl,
        signal: options.signal,
      });
      const candidates = shard ? candidatesFromShard({ ...config, id, label }, shard, context) : [];
      return Object.freeze({
        source: Object.freeze({ id, label }),
        candidates: Object.freeze(candidates),
      });
    },
  });
}
