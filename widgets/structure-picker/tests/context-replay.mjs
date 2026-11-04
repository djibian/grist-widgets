import{findCertifiedEntrance}from"../certified-entrances.js";
import {readOfficialSnapshot} from "../official-snapshots.js";
import {resolveAdministrativeSite} from "../administrative-site.js";
import{readNamedSites}from"../named-site-directory.js";
import { readFile } from "node:fs/promises";
import { findOfficialRegistrySites } from "../official-site-registry.js";
import { resolveEstablishmentForEnrichment } from "../establishment-service.js";
import { findOfficialPublicSites } from "../public-sites.js";
import { findPublishedIdentityLinks } from "../published-identity-links.js";
import { findIndexedSitePositions } from "../site-position-sources.js";
import { findFinessIdentityLinks } from "../finess-identity.js";
import { extractOfficialCandidates } from "../search.js";
const root = new URL("../", import.meta.url);
const json = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
export const rows = await json("tests/fixtures/context/input-rows.json");
const sources = await json("tests/fixtures/context/official-responses.json");
const pom = await json("tests/fixtures/pom-annuaire.json");
export const directory = await json(
  "identity-links/site-directory/records.json",
);
const manifest = {
  schemaVersion: 1,
  generatedAt: "2026-09-14T15:54:51Z",
  sources: Object.fromEntries(
    ["all-the-places", "overture"].map((id) => [
      id,
      {
        label: id,
        pathTemplate: `${id}/{department}/{postcode}.json`,
        shardBy: "postcode",
        departments: ["44", "85"],
      },
    ]),
  ),
};
export async function localTransport(input) {
  const u = new URL(input);
  u.search = "";
  if (u.pathname.endsWith("indexed-departments.json"))
    return Response.json(manifest);
  if (/\/(overture|all-the-places)\/44\/44270\.json$/.test(u.pathname))
    return Response.json(
      await json(
        `tests/fixtures/${u.pathname.includes("overture") ? "overture" : "all-the-places"}-44270.json`,
      ),
    );
  const postcode=u.pathname.match(/\/overture\/(44|85)\/(\d{5})\.json$/)?.[2];
  if(postcode){try{return Response.json(await json(`tests/fixtures/context/postcodes/overture-${postcode}.json`));}catch{}}
  if (u.protocol === "file:") {
    try {
      return new Response(await readFile(u, "utf8"));
    } catch {
      return new Response("", { status: 404 });
    }
  }
  return new Response("", { status: 404 });
}
export function officialReplay(request) {
  let entry = sources.find((source) => source.url === String(request.url));
  if (!entry)
    entry = sources.find(
      (source) => new URL(source.url).searchParams.get("q") === request.query,
    );
  if (!entry && request.requestedSiret)
    entry = sources.find((source) =>
      extractOfficialCandidates(source.payload).items.some(
        (c) => c.siret === request.requestedSiret,
      ),
    );
  const payload =
    entry?.payload ??
    (/pom|rainette|884935834/i.test(request.query)
      ? pom
      : { results: [], total_results: 0, total_pages: 0, page: 1 });
  return {
    ...extractOfficialCandidates(payload, {
      requestedSiret: request.requestedSiret, allowSiegeFallback:request.allowSiegeFallback===true,
    }),
    cached: false,
  };
}
export async function replay(row, extra = {}) {
  return resolveEstablishmentForEnrichment({
    row,
    findEntrance:o=>findCertifiedEntrance({...o,fetchImpl:localTransport}),
    fetchSnapshot: (request,options)=>readOfficialSnapshot(request,{...options,fetchImpl:localTransport}),
    findAdministrativeSite: options => resolveAdministrativeSite({...options,readSites:o=>readNamedSites({...o,fetchImpl:localTransport})}),
    geocode: async () => [],
    fetchOfficial: async (request) => officialReplay(request),
    findRegistrySites: (options) =>
      findOfficialRegistrySites({
        ...options,
        fetchImpl: localTransport,
        allowLive: false,
      }),
    findPublicSites: (options) =>
      findOfficialPublicSites({ ...options, fetchImpl: localTransport }),
    findPublishedLinks: (options) =>
      findPublishedIdentityLinks({ ...options, fetchImpl: localTransport }),
    findSectorLinks: (options) =>
      findFinessIdentityLinks({ ...options, fetchImpl: localTransport }),
    findIndexedPositions: (options) =>
      findIndexedSitePositions({ ...options, fetchImpl: localTransport }),
    findOsmPositions: async () => ({ observations: [], coverage: [] }),
    ...extra,
  });
}
