# Contacts publics multi-source — architecture expérimentale

Cette fonctionnalité enrichit facultativement les structures avec **Téléphone**, **Courriel** et **Site web** sans modifier le moteur stable de l’Assistant Structures.

L’orchestration est indépendante des sources : plusieurs sources publiques peuvent contribuer à une même recherche, leurs résultats sont convertis dans un modèle commun, classés et dédupliqués, et l’indisponibilité d’une source ne bloque jamais les autres.

## Sources retenues

### OpenStreetMap / Overpass

1. Si un SIRET est disponible, recherche prioritaire par `ref:FR:SIRET`.
2. À défaut, recherche locale à partir du nom et des coordonnées.
3. Les résultats sont ensuite soumis au classement commun.

Endpoint : `https://overpass-api.de/api/interpreter`.

### Service-Public.fr (DILA)

L’Annuaire de l’administration est interrogé directement via son API publique.

- SIRET exact lorsqu’un identifiant à 14 chiffres est connu ;
- sinon recherche par nom ;
- téléphone, courriel, site, adresse et coordonnées sont normalisés dans le modèle commun ;
- une égalité de SIRET peut atteindre **Très fiable**.

### Wikidata

- le SIREN dérivé du SIRET est utilisé pour rechercher `P1616` ;
- à défaut, recherche textuelle par nom ;
- téléphone (`P1329`), courriel (`P968`), site (`P856`), coordonnées (`P625`), code postal (`P281`) et adresse (`P6375`) peuvent être exploités ;
- un SIREN Wikidata n’est jamais transformé en SIRET ;
- les déclarations `deprecated` sont ignorées.

Lorsqu’une déclaration Wikidata cite directement l’Annuaire Service-Public.fr, cette provenance est conservée et ne compte pas comme une corroboration indépendante de DILA.

### All The Places

ATP est utilisé comme source complémentaire, surtout pour les enseignes et réseaux disposant de localisateurs publics.

La mesure de référence sur les départements 44 et 85 a retenu **5 483 fiches avec au moins un contact**, dont environ 85 % avec téléphone, 28 % avec courriel et 77 % avec site web. Aucun SIRET exploitable n’était présent dans ces fiches retenues.

ATP n’est donc pas une source d’identité primaire. Le matching repose surtout sur adresse, coordonnées et nom, avec un niveau généralement **Probable** ou **À vérifier**.

### Overture Places

Overture est une source complémentaire majeure, préparée hors navigateur.

La mesure de référence sur le 44 et le 85 a retenu **64 151 fiches avec au moins un contact**, dont environ 93 % avec téléphone, 63 % avec courriel et 83 % avec site web.

Overture agrège plusieurs fournisseurs. Lorsque la lignée d’une fiche contient All The Places, cette concordance n’est pas comptée comme une corroboration indépendante ATP + Overture. Le score `confidence` Overture sert uniquement de signal de départage tardif ; il n’est pas interprété comme une confiance directe dans un téléphone, un courriel ou un site.

## Index statiques ATP + Overture

Les deux sources volumineuses sont préparées hors navigateur puis découpées en **shards par code postal**.

Le fichier `contact-indexes/indexed-departments.json` est le contrat de disponibilité. Il déclare les départements publiés, le mode `shardBy: "postcode"` et les chemins relatifs des shards.

Règles principales :

- schéma versionné ;
- chemins uniquement relatifs au manifest ;
- aucun département supposé disponible s’il n’est pas déclaré ;
- chargement du manifest avec `cache: "no-store"` ;
- cache-busting des shards par la date de génération ;
- un `404` de shard signifie simplement « aucun résultat » ;
- aucun service worker ni cache applicatif.

Le widget déduit le code postal de la structure et ne télécharge que les shards nécessaires.

## Publication des index

`scripts/build-contact-index-snapshot.sh` construit un snapshot cohérent ATP + Overture pour le périmètre déclaré dans `contact-indexes/publication-config.json`.

Le workflow `Publish contact indexes` :

1. télécharge les sources nécessaires ;
2. construit les index intermédiaires ;
3. génère les shards runtime ;
4. exécute les tests ;
5. publie l’artefact `contact-indexes` ;
6. laisse GitHub Pages superposer le dernier snapshot réussi à la production et aux previews.

Le détail opérationnel est documenté dans `CONTACTS-INDEX-PUBLICATION.md`.

## Classement et confiance

Les candidats utilisent trois niveaux communs :

- **Très fiable** : notamment une correspondance SIRET exacte ;
- **Probable** : faisceau suffisamment fort entre adresse, proximité, nom et autres signaux ;
- **À vérifier** : proposition utile mais insuffisamment étayée.

Les signaux sont évalués dans cet ordre de priorité : SIRET exact, adresse exacte, coordonnées, nom, code postal/commune/domaine, puis signaux propres à la source.

Les champs vides et modifiables ne sont présélectionnés que pour une correspondance SIRET exacte.

## Provenance

- chaque proposition conserve la ou les sources qui l’ont produite ;
- les doublons exacts peuvent regrouper plusieurs provenances sans fusion arbitraire des champs ;
- les lignées connues entre sources ne créent jamais artificiellement une preuve indépendante ;
- les alternatives de contact restent séparées lorsqu’aucune source ne permet de les associer avec certitude.

## Sécurité et résilience

- aucune écriture automatique ;
- aucune valeur existante remplacée sans choix explicite ;
- réutilisation du mécanisme d’écriture sécurisé de l’assistant ;
- les champs non mappés ou non modifiables restent désactivés ;
- l’échec d’une source n’empêche pas les autres résultats ni les fonctions stables Annuaire/IGN.

## Statut

Les cinq sources retenues — OSM, DILA, Wikidata, All The Places et Overture Places — sont raccordées au même orchestrateur et réellement disponibles dans le widget publié.

La limite restante est maintenant fonctionnelle : **mesurer la qualité du matching multi-source sur des structures réelles**, notamment les faux positifs, les doublons de provenance et la lisibilité des propositions. La fonctionnalité reste donc explicitement **Expérimentale** jusqu’à cette validation.
