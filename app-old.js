// ========================
// 0. DTO - MODÈLE UNIFIÉ
// ========================

class Result {
  constructor(nom, siret, adresse, source = null) {
    this.nom = nom;
    this.siret = siret;
    this.adresse = adresse;
    this.source = source; // objet brut d'origine (pour traçabilité si besoin)
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
    return new Result(nom, siret, adresse, row);
  }

  /**
   * Crée un Result depuis une réponse API Recherche Entreprises
   */
  static fromEntrepriseAPI(apiResult) {
    const nom = apiResult?.nom_complet || "";
    const siret = apiResult?.siege?.siret || "";
    const adresse = apiResult?.siege?.adresse || "";
    return new Result(nom, siret, adresse, apiResult);
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
  renderRecord();
});


// ========================
// 3. RENDER SIMPLE
// ========================

function renderRecord() {
  const el = document.getElementById("record");

  if (!mapped) {
    el.innerHTML = "⚠ Colonnes non configurées";
    return;
  }

  el.innerHTML = `
    <p><b>Nom :</b> ${mapped.Nom || ""}</p>
    <p><b>Adresse :</b> ${mapped.Adresse || ""}</p>
  `;
}


// ========================
// 4. ACTION UTILISATEUR
// ========================

document.getElementById("btn-search").addEventListener("click", async () => {

  const query = document.getElementById("search").value.trim();

  if (!query) {
    clearResults();
    return;
  }

  const results = await search(query);

  renderResults(results);
});


// ========================
// 5. API ENTREPRISE (placeholder propre)
// ========================

async function search(query) {

    const local = await searchLocal(query);

    if (local.length > 0) {
        return local;
    }

    return await searchEntreprise(query);

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

async function searchEntreprise(query) {

  // API INSEE / SIRENE (simplifiée ici)
  const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  const data = await res.json();

  // Convertir chaque résultat API en Result DTO
  return (data.results || []).map(item => Result.fromEntrepriseAPI(item));
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

function renderResults(results) {

  const container = document.getElementById("results");

  container.innerHTML = "";

  results.slice(0, 5).forEach(result => {

    const div = document.createElement("div");
    div.className = "result";

    // result est maintenant toujours un Result DTO
    div.innerHTML = `
      <b>${result.nom}</b><br>
      ${result.siret || ""}<br>
      ${result.adresse || ""}
      <button>Choisir</button>
    `;

    div.querySelector("button").addEventListener("click", () => {
      applySelection(result);
    });

    container.appendChild(div);
  });
}

function clearResults() {
  document.getElementById("results").innerHTML = "";
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
