import test from "node:test";
import assert from "node:assert/strict";
import { emptyDiscoveryProgress, recordDiscoverySourceEvent } from "../discovery-progress.js";
import { fetchOfficialRequest, resetOfficialClientForTests } from "../enterprise-client.js";
import { buildOfficialTextSearchRequest } from "../search.js";

test("real next request reopens a completed source; previous late events cannot replace it", () => {
  let p = emptyDiscoveryProgress();
  const first = "https://example.org/search?q=first";
  const second = "https://example.org/search?q=second";
  p = recordDiscoverySourceEvent(p, { source: "annuaire:request", state: "start", url: first });
  p = recordDiscoverySourceEvent(p, { source: "annuaire:request", state: "ok", url: first, elapsedMs: 100 });
  p = recordDiscoverySourceEvent(p, { source: "annuaire:request", state: "start", url: second });
  assert.equal(p.activity[0].state, "start", "real second request is shown as active");
  assert.equal(p.activity[0].requestUrl, second);
  p = recordDiscoverySourceEvent(p, { source: "annuaire:request", state: "timeout", url: first });
  assert.equal(p.activity[0].state, "start", "late completion from first request is ignored");
  p = recordDiscoverySourceEvent(p, { source: "annuaire:request", state: "ok", url: second, elapsedMs: 200 });
  assert.equal(p.activity[0].state, "ok");
  p = recordDiscoverySourceEvent(p, { source: "annuaire:request", state: "start", url: second });
  assert.equal(p.activity[0].state, "ok", "duplicate start cannot reopen a completed request");
});

test("unidentified duplicate starts still cannot manufacture progress", () => {
  let p = emptyDiscoveryProgress();
  p = recordDiscoverySourceEvent(p, { source: "annuaire:text", state: "timeout", elapsedMs: 7 });
  p = recordDiscoverySourceEvent(p, { source: "annuaire:text", state: "start" });
  assert.equal(p.activity[0].state, "timeout");
});

test("real Annuaire HTTP lifecycle provides a request URL to the UI event consumer", async () => {
  resetOfficialClientForTests();
  const request = buildOfficialTextSearchRequest("atelier nouveau", { codePostal: "44000" });
  const events = [];
  await fetchOfficialRequest(request, {
    cacheTtlMs: 0,
    fetchImpl: async () => Response.json({ results: [], total_results: 0 }),
    onEvent: event => events.push(event),
  });
  for (const state of ["start", "ok"]) {
    assert.ok(events.some(event => event.source === "annuaire:request" &&
      event.state === state && event.url === request.url),
    "actual lifecycle must carry request identity: " + state);
  }
});
