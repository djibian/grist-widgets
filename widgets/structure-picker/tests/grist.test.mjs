import test from "node:test";
import assert from "node:assert/strict";

import {
  fieldsForCandidate,
  isFormulaColumn,
} from "../grist.js";

test("formula column detection distinguishes formulas from writable data and trigger formulas", () => {
  assert.equal(isFormulaColumn({ isFormula: true, formula: "$A + 1" }), true);
  assert.equal(isFormulaColumn({ isFormula: true, formula: "" }), false);
  assert.equal(isFormulaColumn({ isFormula: false, formula: "$A + 1" }), false);
});

test("candidate fields only target explicitly writable destination mappings", () => {
  const candidate = {
    nomCommercial: "GARAGE MARTIN",
    raisonSociale: "MARTIN AUTOMOBILES",
    siret: "12345678900011",
    siren: "123456789",
    adresse: "12 RUE DES ARTISANS 44270 MACHECOUL-SAINT-MEME",
    codePostal: "44270",
    commune: "MACHECOUL-SAINT-MEME",
    ape: "45.20A",
    latitude: 47.1,
    longitude: -1.8,
  };
  const snapshot = {
    writableMappings: {
      NomCommercial: "Nom_commercial",
      Adresse: "Adresse",
      SirenSiret: "Numero_immatriculation",
      RaisonSociale: "Raison_sociale",
      APE: "APE",
      Latitude: "Latitude",
      Longitude: "Longitude",
    },
  };

  assert.deepEqual(fieldsForCandidate(candidate, snapshot), {
    Nom_commercial: "GARAGE MARTIN",
    Adresse: "12 RUE DES ARTISANS 44270 MACHECOUL-SAINT-MEME",
    Numero_immatriculation: "12345678900011",
    Raison_sociale: "MARTIN AUTOMOBILES",
    APE: "45.20A",
    Latitude: 47.1,
    Longitude: -1.8,
  });
});

test("search-only and formula-derived fields are never written", () => {
  const candidate = {
    nomCommercial: "TEST",
    siret: "12345678900011",
    adresse: "1 RUE TEST 44000 NANTES",
    codePostal: "44000",
    commune: "NANTES",
  };
  const snapshot = {
    writableMappings: {
      NomCommercial: "Nom_commercial",
      Adresse: "Adresse",
      SirenSiret: "Siren_Siret",
      // AdresseNormalisee, CodePostal et Commune sont volontairement absents.
    },
  };

  assert.deepEqual(fieldsForCandidate(candidate, snapshot), {
    Nom_commercial: "TEST",
    Adresse: "1 RUE TEST 44000 NANTES",
    Siren_Siret: "12345678900011",
  });
});
