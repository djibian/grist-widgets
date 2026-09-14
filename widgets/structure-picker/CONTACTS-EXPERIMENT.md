# Expérience — contacts publics multi-source

Cette fonctionnalité expérimentale enrichit facultativement les structures avec **Téléphone**, **Courriel** et **Site web** sans modifier le moteur stable de l'Assistant Structures.

L'interface et l'orchestration sont indépendantes des sources : plusieurs sources publiques peuvent contribuer à la même recherche, leurs résultats sont classés et dédupliqués, et une source indisponible ne bloque pas les autres. Les sources directes sont **OpenStreetMap, Service-Public.fr (DILA) et Wikidata** ; **All The Places** et **Overture Places** sont interrogées à travers des index statiques publiés avec le widget.

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

## Index statiques ATP + Overture

Les sources volumineuses **All The Places** et **Overture Places** sont préparées hors navigateur. Les générateurs produisent d'abord des index départementaux intermédiaires, puis la publication les compacte et les découpe en **shards par code postal**.

Le fichier `contact-indexes/indexed-departments.json` est le contrat de disponibilité. Il déclare pour chaque source les départements publiés, `shardBy: "postcode"` et un patron de chemin de type `{source}/{department}/{postcode}.json`.

Contraintes du contrat V1 :

- schéma versionné (`schemaVersion: 1`) ;
- chemins relatifs au répertoire du manifest, sans URL externe ni traversée `..` ;
- aucun département n'est supposé disponible tant qu'il n'est pas déclaré dans le manifest ;
- chargement du manifest avec `cache: "no-store"` ;
- cache-busting des shards par la date de génération du manifest ;
- un `404` de shard vaut « aucun résultat » et ne bloque pas les autres sources ;
- aucun cache applicatif ou service worker.

Le widget déduit le code postal depuis l'adresse de la structure et ne télécharge qu'un shard par source. La publication et les mesures de taille sont documentées dans `CONTACTS-INDEX-PUBLICATION.md`.

## Générateur All The Places

`scripts/generate-all-the-places-index.mjs` lit les `FeatureCollection` GeoJSON de l'export officiel All The Places, puis :

1. retient les POI français appartenant aux départements demandés ;
2. écarte les POI ne fournissant ni téléphone, ni courriel, ni site web ;
3. conserve l'identité utile (`name`, adresse, SIRET lorsqu'il existe, coordonnées) et la provenance ATP (`id`, spider, ref, URI source) ;
4. déduplique uniquement les identifiants ATP identiques, en conservant la variante la plus riche en contacts ;
5. écrit un index intermédiaire par département.

Le workflow de publication résout et télécharge automatiquement le dernier run ATP avant d'exécuter ce générateur puis le sharding runtime.

La Corse reste volontairement non déduite à partir d'un seul code postal `20xxx`, car ce code ne permet pas de distinguer sûrement `2A` de `2B`.

## Mesure All The Places — 44 / 85

Une mesure complète a été effectuée sur le run ATP `2026-09-05-13-32-25` en parcourant l'archive officielle puis en appliquant le générateur réel aux POI des départements 44 et 85.

Résultat : **5 483 enregistrements uniques avec au moins un contact**, dont :

- **4 675 avec téléphone (85,3 %)** ;
- **1 546 avec courriel (28,2 %)** ;
- **4 198 avec site web (76,6 %)** ;
- **0 avec SIRET** parmi les enregistrements retenus.

Les coordonnées sont présentes sur environ 97 à 98 % des fiches indexées et l'adresse est exploitable sur toutes les fiches retenues. La couverture est particulièrement forte sur les enseignes et réseaux disposant de localisateurs publics.

**Décision : All The Places est retenu comme source complémentaire**, mais pas comme source d'identité primaire. En l'absence de SIRET, le rapprochement repose principalement sur adresse + coordonnées + nom et produit généralement un niveau de confiance `Probable` ou `À vérifier`.

Le détail de la mesure est consigné dans `CONTACTS-ATP-COVERAGE.md`.

## Générateur et mesure Overture Places

`scripts/generate-overture-index.mjs` consomme les exports GeoJSON ou GeoJSONSeq du client officiel Overture. Il conserve le GERS ID, les coordonnées, l'adresse retenue, tous les téléphones/courriels/sites web, le score `confidence`, le statut d'exploitation, la catégorie et la provenance `sources[]` dans l'index intermédiaire.

La mesure du 14 septembre 2026 utilise la release Overture `2026-08-19.0` (`v1.18.0`) et le client officiel `overturemaps 1.0.2`. Une extraction spatiale couvrant le 44 et le 85 contenait 104 780 places ; après filtrage départemental et présence d'au moins un contact, **64 151 fiches** sont indexables :

- **59 823 avec téléphone (93,2 %)** ;
- **40 666 avec courriel (63,4 %)** ;
- **53 177 avec site web (82,9 %)** ;
- **26 878 avec un score `confidence` ≥ 0,80 (41,9 %)** ;
- **13 538 avec un score `confidence` ≥ 0,95 (21,1 %)**.

Overture agrège plusieurs fournisseurs. **1 625 fiches (2,5 %) portent explicitement une lignée All The Places.** Une concordance entre ATP et Overture ne doit donc pas être comptée comme deux preuves indépendantes si la fiche Overture contient cette lignée. Le shard runtime conserve cet état explicitement.

La release mesurée n'expose pas une attribution suffisamment fiable de chaque téléphone/courriel/site à un fournisseur précis. Le runtime conserve donc les valeurs alternatives séparément et **n'invente jamais d'association** entre un téléphone alternatif, un courriel alternatif et un site alternatif.

**Décision : Overture Places est retenu comme source complémentaire majeure**, mais pas comme source d'identité équivalente au SIRET. Le détail est consigné dans `CONTACTS-OVERTURE-COVERAGE.md`.

## Publication et raccordement runtime

Le script `scripts/build-contact-index-snapshot.sh` construit le snapshot cohérent des deux sources pour le périmètre déclaré dans `contact-indexes/publication-config.json`. Le workflow `Publish contact indexes` l'exécute mensuellement et à la demande, lance les tests puis conserve l'artefact `contact-indexes` pendant 90 jours. Pages superpose le dernier artefact réussi à la production et aux previews.

Le pipeline sharded complet a été validé le 14 septembre 2026 sur ATP `2026-09-05-13-32-25` et Overture `2026-08-19.0` : **5 483 ATP + 64 151 Overture**, répartis dans **519 shards de données**, environ **38 MiB non compressés** et **7,65 MiB** comme artefact. Le détail est dans `CONTACTS-INDEX-PUBLICATION.md`.

Le résolveur charge maintenant ATP et Overture dans le même modèle canonique que les sources directes. Pour chaque source indexée :

1. exiger un code postal exploitable ;
2. charger uniquement le shard correspondant ;
3. filtrer localement par SIRET exact, adresse exacte, nom et/ou proximité ;
4. conserver au plus 16 candidats utiles ;
5. appliquer le classement et la déduplication communs à toutes les sources.

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
- une lignée All The Places dans Overture ne compte pas comme une corroboration ATP indépendante ;
- l'état de chaque source interrogée est visible dans l'interface ;
- l'échec d'une source n'empêche pas d'utiliser les résultats des autres sources disponibles.

## Sécurité

- aucune écriture automatique ;
- aucune valeur existante remplacée sans case cochée ;
- réutilisation de `applyEnrichmentChanges()` pour les écritures Grist ;
- si Téléphone, Courriel ou Site web n'est pas mappé ou modifiable, le champ est désactivé ;
- une indisponibilité d'une source de contacts n'empêche pas les fonctions DINUM/IGN.

## Limites restantes

Les cinq sources retenues — OSM, DILA, Wikidata, All The Places et Overture Places — sont maintenant raccordées à l'orchestrateur expérimental. BANCO et FSQ ont été retirés de l'architecture après évaluation.

La limite principale n'est plus technique mais fonctionnelle : **la pertinence réelle du matching multi-source doit maintenant être vérifiée sur des structures présentes dans un vrai document Grist**, en particulier les faux positifs, les doublons de provenance et la lisibilité des propositions. La fonctionnalité conserve explicitement le statut **Expérimental** jusqu'à cette validation.
