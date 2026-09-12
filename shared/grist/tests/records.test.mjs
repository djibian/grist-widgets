import assert from "node:assert/strict";
import test from "node:test";

import { recordsFromTable } from "../records.js";

test("recordsFromTable reconstruit les lignes d'une table Grist", () => {
  const rows = recordsFromTable({
    id: [3, 8],
    Nom: ["Alpha", "Beta"],
    Classe: [12, 14],
  });

  assert.deepEqual(rows, [
    { id: 3, Nom: "Alpha", Classe: 12 },
    { id: 8, Nom: "Beta", Classe: 14 },
  ]);
});

test("recordsFromTable peut normaliser explicitement les identifiants en nombres", () => {
  const rows = recordsFromTable({ id: ["3"], Nom: ["Alpha"] }, { numericIds: true });
  assert.deepEqual(rows, [{ id: 3, Nom: "Alpha" }]);
});

test("recordsFromTable tolère une réponse vide ou partiellement mal formée", () => {
  assert.deepEqual(recordsFromTable(null), []);
  assert.deepEqual(recordsFromTable({ id: [1], Nom: "Alpha" }), [{ id: 1, Nom: null }]);
});
