// ========================
// 0. DTO - MODÈLE UNIFIÉ
// ========================

class Result {
    constructor({
        nom,
        adresse,
        siret = "",
        latitude = null,
        longitude = null,
        origine,
        source
    }) {
        this.nom = nom;
        this.adresse = adresse;
        this.siret = siret;
        this.latitude = latitude;
        this.longitude = longitude;
        this.origine = origine;
        this.source = source;
    }

  /**
   * Crée un Result depuis un enregistrement Grist (ligne locale)
   */
  static fromGristRow(row, mappings) {
    const nom = (row && mappings && row[mappings.Nom]) || 
                (row && row.Nom) || 
                "";
    const siret = (row && mappings && row[mappings.SIRET]) || 
                  (row && row.SIRET) || 
                  "";
    const adresse = (row && mappings && row[mappings.Adresse]) || 
                    (row && row.Adresse) || 
                    "";
    return new Result({ nom, siret, adresse, origine: row, source: row });
  }

  /**
   * Crée un Result depuis une réponse API Recherche Entreprises
   */
  static fromEntrepriseAPI(apiResult) {
    const nom = apiResult?.nom_complet || "";
    const siret = apiResult?.siege?.siret || "";
    const adresse = apiResult?.siege?.adresse || "";
    return new Result({ nom, siret, adresse, origine: apiResult, source: apiResult });
  }
}


// ========================
// 1. CONFIG GRIST
// ========================

grist.ready({
  requiredAccess: "full",
  columns: [
    "Nom",
    "Adresse",
    "SIRET",
    "RaisonSociale",
    "AdresseNormalisee"
  ]
});

let currentRecord = null;
let currentMappings = null;
let mapped = null;


// ========================
// 2. RÉCEPTION DONNÉES
// ========================

grist.onRecord((record, mappings) => {

  currentRecord = record;
  currentMappings = mappings;
  mapped = grist.mapColumnNames(record);

  clearResults();
});


// ========================
// 4. ACTION UTILISATEUR
// ========================

const searchInput = document.getElementById("search");

let searchTimer;

searchInput.addEventListener("input", () => {

    clearTimeout(searchTimer);

    const query = searchInput.value.trim();

    if (query.length < 3) {

        clearResults();

        return;

    }

    searchTimer = setTimeout(() => {

        search(query);

    },300);

});


// ========================
// 5. API ENTREPRISE (placeholder propre)
// ========================

async function search(query) {

    const [localResults, googleResults] = await Promise.all([
        searchLocal(query),
        searchGoogle(query)
    ]);

    renderLocalResults(localResults);

    renderGoogleResults(googleResults);

}

async function searchLocal(query) {

    const tableId = await grist.selectedTable.getTableId();

    // fetchTable retourne un GristData.RowRecords :
    // un objet { colId: [valRow0, valRow1, ...], ... }
    const table = await grist.docApi.fetchTable(tableId);

    // Convertir RowRecords en tableau de lignes [{colId: val, ...}, ...]
    const rows = rowRecordsToRows(table);

    const data = prepareLocalData(rows);

    const fuse = new Fuse(data, {

        includeScore: true,

        threshold: 0.35,

        ignoreLocation: false,

        keys: [

            {
                name: "searchableNom",
                weight: 0.7
            },

            {
                name: "searchableAdresse",
                weight: 0.3
            }

        ]

    });

    const results = fuse.search(normalize(query));

    // On retourne un tableau de Result DTO
    return results
        .slice(0, 5)
        .map(r => r.item.result);

}

// Convertit Grist RowRecords en tableau de lignes.
// Ne modifie pas les arrays originaux (lecture seule).
function rowRecordsToRows(rowRecords) {
  if (!rowRecords || typeof rowRecords !== "object") {
    return [];
  }
  // Si on a déjà un tableau -> le renvoyer directement
  if (Array.isArray(rowRecords)) {
    return rowRecords;
  }
  const colIds = Object.keys(rowRecords);
  if (colIds.length === 0) {
    return [];
  }
  // Utiliser la colonne 'id' si présente pour déterminer le nombre de lignes,
  // sinon prendre la longueur du premier tableau.
  const length = (Array.isArray(rowRecords.id) && rowRecords.id.length) ||
                 (Array.isArray(rowRecords[colIds[0]]) && rowRecords[colIds[0]].length) ||
                 0;

  const rows = new Array(length);
  for (let i = 0; i < length; i++) {
    const row = {};
    for (const col of colIds) {
      // On lit la valeur à l'index i ; si le tableau est plus court, on aura undefined
      const colArr = rowRecords[col];
      row[col] = Array.isArray(colArr) ? colArr[i] : undefined;
    }
    rows[i] = row;
  }
  return rows;
}

// Utilisée plus tard lors de l'ajout d'une structure Google.
async function searchEntreprise(query) {

  // API INSEE / SIRENE (simplifiée ici)
  const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  const data = await res.json();

  // Convertir chaque résultat API en Result DTO
  return (data.results || []).map(item => Result.fromEntrepriseAPI(item));
}

async function searchGoogle(query) {

    return [
        new Result({
            nom: "Résultat Google de test",
            siret: "",
            adresse: "Adresse de test",
            latitude: null,
            longitude: null
        })
    ];

}

function normalize(text) {

    return (text || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim();

}

/**
 * Prépare les données locales pour la recherche Fuse.
 * Chaque item contient :
 *   - result : le Result DTO
 *   - searchableNom : texte normalisé pour Fuse
 *   - searchableAdresse : texte normalisé pour Fuse
 */
function prepareLocalData(rows) {

    rows = Array.isArray(rows) ? rows : [];

    return rows.map(row => {
      const result = Result.fromGristRow(row, currentMappings);
      return {
        result: result,
        searchableNom: normalize(result.nom),
        searchableAdresse: normalize(result.adresse)
      };
    });

}

// ========================
// 6. AFFICHAGE RESULTATS
// ========================

function renderLocalResults(results) {

  const container = document.getElementById("local-results");

  container.innerHTML = "";

  if (results.length === 0) {
    return;
  }

  container.innerHTML = "<h3>📁 Structures déjà enregistrées</h3>";

  results.slice(0,5).forEach(result => {

    const div = document.createElement("div");
    div.className = "result";

    div.innerHTML = `
      <b>${result.nom}</b><br>
      ${result.siret || ""}<br>
      ${result.adresse || ""}<br>
      <button>Choisir</button>
    `;

    div.querySelector("button").addEventListener("click", () => {
      applySelection(result);
    });

    container.appendChild(div);

  });

}

function renderGoogleResults(results) {

  const container = document.getElementById("google-results");

  container.innerHTML = "";

  if (results.length === 0) {
    return;
  }

  container.innerHTML = "<h3>🌍 Nouvelles structures trouvées</h3>";

  results.slice(0,5).forEach(result => {

    const div = document.createElement("div");
    div.className = "result";

    div.innerHTML = `
      <b>${result.nom}</b><br>
      ${result.adresse || ""}<br>
      <button>Ajouter</button>
    `;

    div.querySelector("button").addEventListener("click", () => {

      console.log(result);

    });

    container.appendChild(div);

  });

}

function clearResults() {

  document.getElementById("local-results").innerHTML = "";

  document.getElementById("google-results").innerHTML = "";

}

// ========================
// 7. ÉCRITURE DANS GRIST
// ========================

function applySelection(result) {

  if (!currentRecord || !currentMappings) {
    return;
  }

  // result est un Result DTO : les propriétés sont toujours au même endroit
  const values = {
    [currentMappings.SIRET]: result.siret,
    [currentMappings.RaisonSociale]: result.nom,
    [currentMappings.AdresseNormalisee]: result.adresse
  };

  grist.selectedTable.update({
      id: currentRecord.id,
      fields: values
    });
}
