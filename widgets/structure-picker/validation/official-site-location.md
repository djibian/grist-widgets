# Deux positions de site démontrées — 27 octobre 2026

Ce complément remplace les abstentions Alliance/Legé décrites dans l’audit historique [resilient-resolution.md](resilient-resolution.md). Les textes Grist exacts restent les entrées du corpus ; aucun identifiant attendu n’est injecté dans la découverte. Aucune fiche du document réel n’a été écrite.

## Cause et correction

L’Alliance était identifiée par son UAI et son SIRET, mais OSM déclare sa position imprécise (`fixme=position exacte à définir`). L’association adresse–bâtiment BDNB n’était pas unique. Ces refus sont conservés. Le pipeline ne consultait pas les emprises de sites IGN portant explicitement les UAI.

Legé était bloqué par une seconde limite : toute position exigeait un SIRET de site, même pour un lieu public attesté par une collectivité. Les recherches juridiques ne démontrent pas de SIRET propre à cette Maison de l’enfance. Cela ne rend pas sa localisation impossible : sa fiche municipale publie son nom, son adresse et son propre marqueur cartographique.

Deux chemins génériques, sans règle de nom, de SIRET ou de coordonnées :

- **Site scolaire légalement confirmé** : UAI Éducation ↔ SIRET géographique revalidé Annuaire ↔ UAI porté par une emprise physique IGN ; nom, type, commune et adresse doivent concorder. Emprise fictive, type voisin, adresse différente, plusieurs UAI ou contradiction → abstention. Le point représentatif doit être strictement dans l’emprise. La précision de la frontière IGN n’est pas une garantie de précision du point représentatif.
- **Site public sans identifiant légal démontré** : Service-Public/DILA atteste le domaine de la collectivité ; une fiche sur ce domaine publie un marqueur nommé et une adresse concordante. Nom public exact normalisé + voie + commune sont requis. `identityScope: PUBLIC_SITE`, identifiant stable de fiche, aucun SIRET/SIREN/raison sociale attribué. L’UI dit explicitement « Site public confirmé — SIRET propre au site non établi ». Le candidat reste unique : identité de lieu, adresse, position et preuves.

Le second chemin est indépendant des recherches juridiques lentes. Une preuve complète peut terminer la recherche et annuler les transports inutiles. Les sources de position restent soumises au budget existant et aux contradictions entre observations recevables. Les points de voie, centres de commune, boîtes englobantes et POI voisins ne sont pas promus.

## Sources et coordonnées

| Site | Chaîne de preuves | Point proposé par le widget |
|---|---|---|
| Maison de l’enfance, Legé | [Service-Public : Mairie de Legé](https://lannuaire.service-public.gouv.fr/pays-de-la-loire/loire-atlantique/0d6e48f1-a798-497b-9a30-fb7cc6ad5058) atteste `ville-lege44.fr` ; [fiche municipale 6294](https://www.ville-lege44.fr/fiche-annuaire/maison-de-lenfance/) : nom, place du Champ de Foire, marqueur propre `data-lat`/`data-lng` ; fiche modifiée le 2023-12-04, recapturée le 2026-10-27 | **46.8861988, -1.5975397** — point de site publié, exactitude métrique non documentée |
| École de l’Alliance, Challans | Éducation UAI `0851256D` ↔ Annuaire SIRET `32548690000062` ; IGN BD TOPO `SURFACTI0000000070239731`, `MEN:0851256D`, 55 boulevard Jean XXIII, groupe scolaire en service, géométrie issue d’orthophotographie ; modification le 2026-05-04, confirmation le 2026-04-10, capture le 2026-10-27 | **46.837845928769546, -1.8654216256569214** — point intérieur représentatif de l’emprise du site scolaire |

Les liens Google donnés par l’utilisateur ont aidé la recherche ; aucune donnée Google n’est nécessaire au résolveur ni à son index. Le point Google de l’Alliance (`46.8371761, -1.8664473`) appartient strictement à cette même emprise IGN, ce qu’un test vérifie. Le point du widget diffère : il est calculé depuis l’emprise officielle et ne prétend pas désigner une entrée ou un toit. À Legé, le point municipal coïncide avec celui du lien utilisateur ; le contenu natif de la fiche municipale suffit comme preuve indépendante. Le numéro « 10ter » vient de la saisie : la fiche municipale ne publie que la voie, donc aucune normalisation d’adresse ni attribution juridique n’en est déduite.

## Index reproductibles et couverture

Les outils travaillent par **cohortes complètes de sources**, puis filtrent sur des attributs de source, jamais sur une liste de noms :

- IGN : 124 objets de la commune `85047` lus intégralement ; 21 objets géométriques portant un UAI, 22 occurrences réparties en 18 préfixes. Les objets fictifs ou contradictoires sont conservés dans la source mais refusés à l’évaluation. Fichiers bornés à 96 Kio, partitionnés par commune puis préfixe UAI. Un renouvellement supprime les préfixes retirés uniquement dans la commune concernée.
- Annuaire municipal : 87 fiches intégralement énumérées ; cohorte native des 12 services municipaux ; 6 sites dont la fiche possède exactement un marqueur propre et une adresse locale. La capture conserve l’extrait HTML natif et le SHA-256 de la page complète. Le domaine de publication est vérifié contre le dossier DILA natif, sans emprunter le SIRET de la mairie.

Commandes et limites d’extension : [index IGN](../site-position-indexes/ign-education/README.md), [annuaire public](../identity-links/public-sites/README.md). Cette couverture géographique initiale n’est pas une couverture nationale automatique. Un nouveau territoire exige la génération de sa cohorte ; une source hors couverture reste explicite et ne bloque pas les autres sources. Aucun appel WFS ou scraping municipal n’est ajouté au navigateur.

## Écritures et tests

Un site public sans SIRET ne permet que la paire latitude/longitude et ses preuves. La ligne doit toujours correspondre au nom/adresse analysés, ne porter aucun identifiant légal, et être inchangée après relecture Grist. La preuve native, les coordonnées et l’identifiant de fiche sont revérifiés avant application atomique. Toute tentative d’ajouter un SIRET de gestionnaire, de changer un autre champ ou d’altérer les coordonnées est rejetée. Les garanties historiques sur les écritures liées à un SIRET restent appliquées.

Les régressions couvrent les neuf saisies réelles, les quatre références historiques, la position de l’Alliance et le point municipal, le collège voisin, Maison des Jeunes, une autre adresse/commune, les géométries fictives, les identifiants contradictoires, les sources lentes, l’annulation, la sélection changée et les écritures Grist. L’hôte instrumenté exécute le véritable contrôleur UI et son résolveur.

Validation locale : **437 tests réussis, aucun échec** (`npm test` : 7 partagés, 339 structure-picker, 64 affectation, 20 itinéraires, 7 courriel). Les [captures réseau](official-sites-live-summary.json) et [réponses primaires](official-sites-public-responses.json) distinguent une preuve statique versionnée, une réponse réseau et une indisponibilité réseau. Les captures historiques restent disponibles pour comparer les diagnostics avant correction.

## Dernier rejeu réseau complet

Capture : 2026-10-27T17:58:58.809Z. Les sondes SIRET de contrôle ont lieu après chaque décision et ne l’alimentent pas.

| Fiche | Identité | Position | Durée du pipeline |
|---|---|---|---|
| alliance | MATCH_VERIFIED — 32548690000062 | 46.837845928769546, -1.8654216256569214 | 9752 ms |
| guillonneau | MATCH_VERIFIED — 26850050100070 | 46.8389449, -1.881625298666242 | 4598 ms |
| marie-no-postal | MATCH_VERIFIED — 78605938600023 | 47.0546423, -1.725960678965821 | 4582 ms |
| marie-postal | MATCH_VERIFIED — 78605938600023 | 47.0546423, -1.725960678965821 | 4451 ms |
| enfance | MATCH_VERIFIED — Site public ; SIRET non établi | 46.8861988, -1.5975397 | 16 ms |
| super-u-machecoul | MATCH_VERIFIED — 41091808000020 | 46.99808, -1.815576 | 8740 ms |
| ehpad-la-reynerie | MATCH_VERIFIED — 26850025300011 | 46.9742242, -1.9937342 | 4456 ms |
| o-pre-d-vous | MATCH_VERIFIED — 89306104400028 | 46.99756389, -1.7365524 | 4370 ms |
| pom-de-rainette | MATCH_VERIFIED — 88493583400033 | 46.868617815626294, -1.942076105568997 | 4595 ms |
