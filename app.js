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
    "AdresseNormalisee",
    "Latitude",
    "Longitude"
  ]
});

let currentRecord = null;
let mapped = null;


// ========================
// 2. RÉCEPTION DONNÉES
// ========================

grist.onRecord((record) => {
  currentRecord = record;
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

  if (!mapped) return;

  const query = `${mapped.Nom || ""} ${mapped.Adresse || ""}`.trim();

  const results = await searchEntreprise(query);

  renderResults(results);
});


// ========================
// 5. API ENTREPRISE (placeholder propre)
// ========================

async function searchEntreprise(query) {

  // API INSEE / SIRENE (simplifiée ici)
  const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  const data = await res.json();

  return data.results || [];
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

    div.innerHTML = `
      <b>${r.nom_complet}</b><br>
      ${r.siege?.siret || ""}<br>
      ${r.siege?.adresse || ""}
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
  grist.docApi.applyUserActions([
    ["UpdateRecord", null, currentRecord.id, {

      SIRET: r.siege?.siret,
      RaisonSociale: r.nom_complet,
      AdresseNormalisee: r.siege?.adresse,
      Latitude: r.siege?.latitude,
      Longitude: r.siege?.longitude

    }]
  ]);
}
