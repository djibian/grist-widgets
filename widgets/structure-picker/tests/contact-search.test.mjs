import assert from "node:assert/strict";
import test from "node:test";
import { availableContactSources, searchContactSources } from "../contact-search.js";

function fakeSource(id, options = {}) {
  const { available = true, candidates = [], failure = null } = options;
  return Object.freeze({
    id,
    label: `Source ${id.toUpperCase()}`,
    canSearch() { return available; },
    async search() {
      if (failure) throw failure;
      return { candidates };
    },
  });
}

test("availableContactSources keeps only eligible sources", () => {
  const sources = [
    fakeSource("a", { available: true }),
    fakeSource("b", { available: false }),
    fakeSource("c", { available: true }),
  ];
  assert.deepEqual(availableContactSources({ siret: "123" }, sources).map(source => source.id), ["a", "c"]);
});

test("searchContactSources aggregates candidates and reports a partial failure", async () => {
  const first = { contacts: { telephone: "01" } };
  const second = { contacts: { courriel: "a@example.fr" } };
  const sources = [
    fakeSource("a", { candidates: [first, second] }),
    fakeSource("b", { failure: new Error("service indisponible") }),
    fakeSource("c", { available: false }),
  ];

  const result = await searchContactSources({ name: "Test" }, { sources });
  assert.deepEqual(result.candidates, [first, second]);
  assert.deepEqual(result.states.map(state => ({ id: state.id, status: state.status, candidateCount: state.candidateCount })), [
    { id: "a", status: "success", candidateCount: 2 },
    { id: "b", status: "error", candidateCount: 0 },
  ]);
  assert.match(result.states[1].error, /indisponible/);
});

test("searchContactSources propagates AbortError", async () => {
  const failure = new Error("aborted");
  failure.name = "AbortError";
  await assert.rejects(
    () => searchContactSources({}, { sources: [fakeSource("a", { failure })] }),
    current => current?.name === "AbortError",
  );
});
