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
                name: "nom",
                weight: 0.7
            },

            {
                name: "adresse",
                weight: 0.3
            }

        ]

    });

    const results = fuse.search(normalize(query));

    // On renvoie l'objet "record" original (chaque item est {record, nom, adresse})
    return results
        .slice(0,5)
        .map(r => r.item.record);

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

  return data.results || [];
}

function normalize(text) {

    return (text || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim();

}

// prepareLocalData accepte maintenant un tableau de lignes (rows)
function prepareLocalData(rows) {

    rows = Array.isArray(rows) ? rows : [];

    return rows.map(row => ({

        record: row,

        nom: normalize(row && currentMappings ? row[currentMappings.Nom] : (row && row.Nom) ),

        adresse: normalize(row && currentMappings ? row[currentMappings.Adresse] : (row && row.Adresse) )

    }));

}

// ========================
// 6. AFFICHAGE RESULTATS
// ========================

function renderResults(results) {

  const container = document.getElementById("results");

  container.innerHTML = "";

  results.slice(0, 5).forEach(r => {

    const div = document.createElement("div");
    div.className = "result";

    // Supporter deux formes de résultats :
    // - résultat "entreprise" depuis l'API : r.nom_complet, r.siege.{siret,adresse}
    // - résultat local (ligne) : r is a record/object with columns accessed via currentMappings
    let displayName = "";
    let siret = "";
    let adresse = "";

    if (r && (r.nom_complet || r.siege)) {
      // forme API entreprise
      displayName = r.nom_complet || "";
      siret = r.siege?.siret || "";
      adresse = r.siege?.adresse || "";
    } else {
      // forme locale (ligne)
      displayName = (r && currentMappings && r[currentMappings.RaisonSociale]) ||
                    (r && currentMappings && r[currentMappings.Nom]) ||
                    (r && r.Nom) ||
                    (r && r.name) ||
                    "";
      siret = (r && currentMappings && r[currentMappings.SIRET]) || (r && r.SIRET) || "";
      adresse = (r && currentMappings && r[currentMappings.Adresse]) || (r && r.Adresse) || "";
    }

    div.innerHTML = `
      <b>${displayName}</b><br>
      ${siret || ""}<br>
      ${adresse || ""}
      <button>Choisir</button>
    `;

    div.querySelector("button").addEventListener("click", () => {
      applySelection(r);
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

function applySelection(r) {

  if (!currentRecord || !currentMappings) {
    return;
  }

  // Supporter sélection de résultat entreprise ou sélection d'une ligne locale.
  const siret = r?.siege?.siret || r[currentMappings.SIRET] || r.SIRET || null;
  const raison = r?.nom_complet || r[currentMappings.RaisonSociale] || r[currentMappings.Nom] || r.Nom || null;
  const adresse = r?.siege?.adresse || r[currentMappings.AdresseNormalisee] || r[currentMappings.Adresse] || r.Adresse || null;

  const values = {
    [currentMappings.SIRET]: siret,
    [currentMappings.RaisonSociale]: raison,
    [currentMappings.AdresseNormalisee]: adresse
  };

  grist.selectedTable.update({
      id: currentRecord.id,
      fields: values
    });
}
