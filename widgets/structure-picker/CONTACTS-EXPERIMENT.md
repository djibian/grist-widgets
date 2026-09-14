# Expérience — contacts publics multi-source

Cette fonctionnalité expérimentale enrichit facultativement les structures avec **Téléphone**, **Courriel** et **Site web** sans modifier le moteur stable de l'Assistant Structures.

L'interface et l'orchestration sont indépendantes des sources : plusieurs sources publiques peuvent contribuer à la même recherche, leurs résultats sont classés et dédupliqués, et une source indisponible ne bloque pas les autres. **OpenStreetMap, Service-Public.fr (DILA) et Wikidata sont les sources directes actuellement interrogées par le widget expérimental.**

## Stratégie actuelle — OpenStreetMap

1. Si la ligne Grist possède un SIRET, interroger OpenStreetMap par `ref:FR:SIRET`.
2. Si aucun contact exploitable n'est trouvé, et si un nom + des coordonnées sont disponibles, chercher dans un rayon de 300 m les objets OSM nommés qui publient au moins un contact.
3. Convertir les résultats dans le modèle commun, puis appliquer la déduplication exacte et le classement commun avant affichage.

Endpoint Overpass : `https://overpass-api.de/api/interpreter`.

## Sources directes — Service-Public.fr (DILA) et Wikidata

L'Annuaire de l'administration de Service-Public.fr est interrogé directement via son API publique. Un contrôle réel effectué le 14 septembre 2026 comptait **93 772 entrées** et confirmait la présence de SIREN/SIRET, téléphone, courriel, site web, adresses et coordonnées, avec accès CORS depuis le navigateur.

Stratégie DILA :

1. lorsqu'un SIRET à 14 chiffres est connu, rechercher ce SIRET exact ;
2. sinon, rechercher le nom de la structure ;
3. parser défensivement les champs structurés de l'API (`telephone`, `site_internet`, `adresse`) ;
4. une égalité de SIRET produit une correspondance `exact-siret` et peut donc atteindre **Très fiable** ;
5. une recherche textuelle reste soumise au classement commun par nom, adresse et coordonnées.

Wikidata est utilisé comme source complémentaire :

1. lorsqu'un SIRET est connu, ses 9 premiers chiffres donnent le SIREN et le Wikidata Query Service recherche les items portant exactement ce SIREN (`P1616`) ;
2. si aucun item n'est trouvé, ou si aucun SIREN n'est disponible, l'API REST Wikidata recherche le nom ;
3. les items retenus sont lus via l'API REST actuelle et peuvent fournir téléphone (`P1329`), courriel (`P968`), site officiel (`P856`), coordonnées (`P625`), code postal (`P281`) et adresse (`P6375`) ;
4. les déclarations `deprecated` sont ignorées ; une déclaration `preferred` est prioritaire sur une déclaration `normal` ;
5. un SIREN Wikidata n'est **jamais converti en SIRET** : il sert seulement à réduire les faux positifs et à améliorer le classement. Sans autre preuve, il ne suffit pas à produire `Très fiable`.

Certaines déclarations Wikidata citent directement l'Annuaire Service-Public.fr (`Q97451652`) comme référence. Lorsque le téléphone, courriel ou site effectivement retenu porte cette référence, la provenance DILA est conservée dans le candidat Wikidata : une concordance DILA + Wikidata issue de cette même donnée ne doit pas être considérée comme deux preuves indépendantes.

## Index statiques par département

Les sources volumineuses **All The Places** et **Overture Places** sont préparées hors navigateur sous forme d'index JSON statiques par département.

Le fichier `contact-indexes/indexed-departments.json` est le contrat de disponibilité : pour chaque source, il contient un patron de chemin relatif et la liste des départements effectivement publiés. Une source ne doit tenter de charger que l'intersection entre cette liste et les départements actifs du widget Grist.

Contraintes du contrat V1 :

- schéma versionné (`schemaVersion: 1`) ;
- chemins relatifs au répertoire du manifest, sans URL externe ni traversée `..` ;
- aucun département n'est supposé disponible tant qu'il n'est pas déclaré dans le manifest ;
- chargement du manifest avec `cache: "no-store"` ;
- aucun cache applicatif ou service worker.

Le périmètre et le mécanisme de génération/publication périodique sont documentés dans `CONTACTS-INDEX-PUBLICATION.md`.

## Générateur All The Places

`scripts/generate-all-the-places-index.mjs` lit les `FeatureCollection` GeoJSON de l'export officiel All The Places, puis :

1. retient les POI français appartenant aux départements demandés ;
2. écarte les POI ne fournissant ni téléphone, ni courriel, ni site web ;
3. conserve l'identité utile (`name`, adresse, SIRET lorsqu'il existe, coordonnées) et la provenance ATP (`id`, spider, ref, URI source) ;
4. déduplique uniquement les identifiants ATP identiques, en conservant la variante la plus riche en contacts ;
5. écrit un fichier compact par département ;
6. met à jour dans le manifest uniquement la disponibilité de `all-the-places`.

Le générateur ne télécharge rien et n'exécute aucune commande système. Pour un export officiel :

```sh
curl -L https://data.alltheplaces.xyz/runs/latest.zip -o /tmp/alltheplaces.zip
unzip -q /tmp/alltheplaces.zip -d /tmp/alltheplaces
npm run generate:contacts:atp -- --input /tmp/alltheplaces --departments 44,85
```

On peut ajouter `--run-id <identifiant>` pour conserver l'identifiant du run ATP dans chaque index. Le workflow de publication résout et télécharge automatiquement le dernier run ATP avant d'exécuter ce générateur.

Format produit :

```json
{
  "schemaVersion": 1,
  "source": "all-the-places",
  "department": "44",
  "generatedAt": "...",
  "upstream": { "project": "All The Places", "runId": "..." },
  "recordCount": 123,
  "records": []
}
```

La Corse reste volontairement non déduite à partir d'un seul code postal `20xxx`, car ce code ne permet pas de distinguer sûrement `2A` de `2B`.

## Mesure All The Places — 44 / 85

Une mesure complète a été effectuée sur le run ATP `2026-09-05-13-32-25` en parcourant l'archive officielle puis en appliquant le générateur réel aux POI des départements 44 et 85.

Résultat : **5 483 enregistrements uniques avec au moins un contact**, dont :

- **4 675 avec téléphone (85,3 %)** ;
- **1 546 avec courriel (28,2 %)** ;
- **4 198 avec site web (76,6 %)** ;
- **0 avec SIRET** parmi les enregistrements retenus.

Les coordonnées sont présentes sur environ 97 à 98 % des fiches indexées et l'adresse est exploitable sur toutes les fiches retenues. La couverture est particulièrement forte sur les enseignes et réseaux disposant de localisateurs publics.

**Décision : All The Places est retenu comme source complémentaire**, mais pas comme source d'identité primaire. En l'absence de SIRET, le rapprochement devra principalement s'appuyer sur adresse + coordonnées + nom et produire généralement un niveau de confiance `Probable`. Les autres sources indexées restent nécessaires pour élargir la couverture et corroborer les propositions.

Le détail de la mesure, ses limites et sa méthode sont consignés dans `CONTACTS-ATP-COVERAGE.md`. Cette mesure évalue la densité de contacts disponible dans ATP ; elle ne mesure pas encore le taux de correspondance avec les structures effectivement présentes dans un document Grist.

## Générateur et mesure Overture Places

`scripts/generate-overture-index.mjs` consomme les exports GeoJSON ou GeoJSONSeq du client officiel Overture et produit le même type d'index JSON départemental. Il conserve le GERS ID, les coordonnées, l'adresse retenue, tous les téléphones/courriels/sites web, le score `confidence`, le statut d'exploitation, la catégorie et la provenance `sources[]`.

Le générateur :

1. sélectionne une adresse française appartenant aux départements demandés ;
2. exclut les établissements `permanently_closed` ;
3. écarte les fiches sans téléphone, courriel ni site web ;
4. préserve l'ensemble des contacts tout en fournissant un contact principal compatible avec le modèle commun ;
5. déduplique seulement un même GERS ID et conserve la variante la plus riche ;
6. met à jour uniquement la disponibilité `overture` du manifest lorsqu'il est utilisé pour une publication réelle.

La mesure du 14 septembre 2026 utilise la release Overture `2026-08-19.0` (`v1.18.0`) et le client officiel `overturemaps 1.0.2`. Une extraction spatiale couvrant le 44 et le 85 contenait 104 780 places ; après filtrage départemental et présence d'au moins un contact, **64 151 fiches** sont indexables :

- **59 823 avec téléphone (93,2 %)** ;
- **40 666 avec courriel (63,4 %)** ;
- **53 177 avec site web (82,9 %)** ;
- **26 878 avec un score `confidence` ≥ 0,80 (41,9 %)** ;
- **13 538 avec un score `confidence` ≥ 0,95 (21,1 %)**.

Overture agrège plusieurs fournisseurs. Dans cette mesure, les principales provenances amont sont `meta`, `Foursquare`, `AllThePlaces`, `PinMeTo` et `DAC`. **1 625 fiches (2,5 %) portent explicitement une lignée All The Places.** Une concordance entre ATP et Overture ne doit donc pas être comptée comme deux preuves indépendantes si la fiche Overture contient cette lignée. La provenance conservée permet d'appliquer cette règle plus tard dans le classement.

La release mesurée n'expose pas, dans notre extraction, une attribution suffisamment fiable de chaque téléphone/courriel/site à un fournisseur précis. Le score `confidence` Overture mesure par ailleurs l'existence du lieu et non l'exactitude d'un contact particulier.

**Décision : Overture Places est retenu comme source complémentaire majeure**, mais pas comme source d'identité équivalente au SIRET. Le détail est consigné dans `CONTACTS-OVERTURE-COVERAGE.md`.

## Publication périodique ATP + Overture

Le script `scripts/build-contact-index-snapshot.sh` construit un snapshot cohérent des deux sources pour le périmètre déclaré dans `contact-indexes/publication-config.json`. Le workflow `Publish contact indexes` l'exécute mensuellement et à la demande, lance ensuite tous les tests puis conserve le résultat sous forme d'un artefact GitHub Actions `contact-indexes` pendant 90 jours.

Les gros JSON ne sont jamais committés dans `main`. Le workflow Pages récupère le dernier artefact réussi et le superpose à la production ainsi qu'aux previews. En l'absence d'artefact valide, le manifest vide de `main` reste servi et les sources directes continuent de fonctionner.

Le pipeline complet a été vérifié le 14 septembre 2026 sur le run ATP `2026-09-05-13-32-25` et la release Overture `2026-08-19.0` : **63 MiB** de JSON non compressés, environ **10,4 MiB** sous forme d'artefact, génération et suite de tests réussies. Les détails et tailles par département sont consignés dans `CONTACTS-INDEX-PUBLICATION.md`.

## Confiance

Les candidats utilisent trois niveaux communs à toutes les sources :

- **Très fiable** : notamment une correspondance SIRET exacte ;
- **Probable** : faisceau suffisamment fort (adresse, proximité géographique + nom, etc.) ;
- **À vérifier** : proposition utile mais insuffisamment étayée pour être considérée comme probable.

Les champs actuellement vides et modifiables ne sont présélectionnés que pour une correspondance SIRET exacte. L'utilisateur doit toujours cliquer sur **Appliquer les contacts cochés**.

## Provenance et résilience

- chaque proposition conserve la ou les sources qui l'ont produite ;
- les doublons exacts peuvent regrouper plusieurs provenances sans fusionner arbitrairement leurs champs ;
- une provenance agrégée n'est pas automatiquement une preuve indépendante d'une autre source ;
- une référence Service-Public conservée dans Wikidata ne compte pas comme une corroboration indépendante de DILA ;
- l'état de chaque source interrogée est visible dans l'interface ;
- l'échec d'une source n'empêche pas d'utiliser les résultats des autres sources disponibles.

## Sécurité

- aucune écriture automatique ;
- aucune valeur existante remplacée sans case cochée ;
- réutilisation de `applyEnrichmentChanges()` pour les écritures Grist ;
- si Téléphone, Courriel ou Site web n'est pas mappé ou modifiable, le champ est désactivé ;
- une indisponibilité d'une source de contacts n'empêche pas les fonctions DINUM/IGN.

## Limites restantes

Les trois sources directes OSM, DILA et Wikidata sont raccordées à l'orchestrateur expérimental. DILA apporte une identité SIRET particulièrement forte pour les administrations ; Wikidata reste volontairement conservateur et sert surtout de complément ou de corroboration.

All The Places et Overture Places disposent maintenant d'une mécanique de génération et de publication périodique validée. **Ils ne sont toutefois pas encore raccordés au runtime du résolveur** : publier les JSON les rend disponibles sur Pages, mais le widget ne les interroge pas encore.

BANCO et FSQ ont été retirés de l'architecture après évaluation. La prochaine étape fonctionnelle est donc le chargement et le matching des index ATP + Overture dans l'orchestrateur, puis la validation sur des structures réelles dans Grist. La fonctionnalité conserve explicitement le statut **Expérimental** tant que cette pertinence n'a pas été vérifiée.
