# Corrections de l’Assistant Structures — point de reprise du 4 novembre 2026

## État réel de la livraison

Le dépôt est `djibian/grist-widgets`, la PR en brouillon est #85. Son dernier commit publié reste `a17cf77fa376f3ca2bb2aea8cd194aade23ea69d` ; la branche `preview/structure-picker` pointe encore sur ce même commit.

**Les modifications de code décrites ci-dessous ont été préparées dans l’environnement local, mais n’ont pas été publiées.** L’environnement est devenu indisponible avant la validation finale et le transfert du code. Ce document conserve la recherche et le point de reprise ; il ne constitue pas une livraison fonctionnelle de ces modifications. Ne pas fusionner la PR ni déplacer la prévisualisation sur la seule base de cette note.

L’environnement à reprendre, s’il redevient accessible, est `/workspace/scratch/165a7b4406a8/grist-widgets`, branche locale `feat/structure-picker-context-confidence`. Le dernier échec d’accès est `exec-server transport disconnected; failed to resume exec-server session: recovery timed out after 45s`.

## Demande utilisateur à conserver

- Proposer et précocher les améliorations fiables, y compris lorsqu’une valeur existe déjà.
- Appliquer systématiquement les conventions de nom usuel, adresse, immatriculation et téléphone.
- Retrouver l’identité, l’adresse physique, les coordonnées et les contacts des nouvelles comme des anciennes structures, en combinant tous les champs utiles.
- Présenter un indice numérique coloré et conserver les détails de services/sources dans des éléments repliés.
- Distinguer adresse de mairie et implantation physique des écoles.
- Ne pas créer de règles de résolution fondées sur des numéros de ligne ou des résultats attendus.

## Conventions retenues

| Champ | Convention | Exemple |
|---|---|---|
| Nom usuel | Casse de phrase — Commune ; accents et initiales de marque isolées conservés | Espace et vie — Pornic ; Super U — Machecoul-Saint-Même |
| Adresse | Numéro [bis/ter] type de voie Nom propre, code postal Commune | 10 ter place du Champ de Foire, 44650 Legé |
| SIRET | 3 + 3 + 3 + 5 chiffres séparés par des espaces | 268 500 659 00027 |
| SIREN | 3 + 3 + 3 chiffres | 214 400 814 |
| Téléphone français | Cinq groupes séparés par des points | 02.51.74.33.00 |
| Raison sociale | Dénomination officielle ; gestionnaire explicité si nécessaire | COMMUNE DE LEGE |

La commune est systématique pour désambiguïser sans dépendre d’une connaissance exhaustive des homonymes nationaux. BP/CS/CEDEX et zones redondantes sont retirés de l’adresse physique ; les numéros/suffixes plus précis ne sont pas perdus. Les comparaisons d’identité restent indépendantes de la présentation.

## Résultats de recherche établis avant l’interruption

Le document Grist `hwaq482dXqJwkB3zECwYdv`, table `Structures_de_stage`, contient toujours 25 lignes. Une relecture en fin de travail a confirmé que les données n’avaient pas changé depuis la première lecture. Aucune écriture dans ce document n’a été exécutée.

Le rejeu local préparé reconnaissait les 25 lieux, établissait 22 positions et revalidait 21 immatriculations propres au lieu. Ces chiffres concernent le code local non publié.

| Structure | Immatriculation | Raison sociale / portée | Position démontrée |
|---|---|---|---|
| Maison de l’enfance — Legé | 214 400 814 00015 **du gestionnaire** | COMMUNE DE LEGE ; ne pas attribuer ce SIRET de mairie au lieu sans expliciter sa portée | 46.8861988, -1.5975397 |
| Espace et vie — Pornic (3 lignes) | 812 372 266 00021 | G2L PORNIC | 47.1146032, -2.0863187 |
| Retz accueil — Machecoul-Saint-Même | 484 897 004 00020 | RETZ ACCUEIL | 46.99342230076351, -1.820715751496167 (bâtiment) ; point indépendant 46.99342238, -1.8207634 |
| École Notre-Dame de Lourdes — Sainte-Pazanne | 788 352 235 00030 | OGEC DE SAINTE PAZANNE | 47.1047806, -1.81010083921502 |
| Groupe scolaire Jacques-Yves Cousteau (2 lignes) | 200 056 455 00047 | COMMUNE DE MACHECOUL-SAINT-MEME | 46.996215702182994, -1.8161905219952938 |
| Ehpad les Mimosas — Commequiers | **268 500 659 00027**, remplace le numéro saisi avec 654 | CTRE COM ACTION SOCIALE DE COMMEQUIERS | 46.76096621, -1.83506591 |
| La Villa des petits Garnachois | Non attribuée faute de lien de gestion suffisamment documenté | Piste : CRECHES EXPANSION CHALLANS, 80227197300033, actif rue des Ciseleurs | 46.89237613666781, -1.849822480838871 (bâtiment du numéro 6) |
| Paz à pas — Sainte-Pazanne | 786 072 694 00049 | ASSOCIATION PAZ  A PAS | 47.0967935, -1.8120844 |
| Roule ta bille — La Bernerie-en-Retz | 790 807 077 00017 | ROULE TA BILLE | 47.08114443, -2.03425693 |

Les positions historiques de Super U, La Reynerie, Ô Pré d’Vous, Pom’de rainette et les écoles déjà traitées restent conservées. Le détail des 25 fiches et des propositions avait été généré dans `artifacts/structure-v2-review.json` et `docs/structure-picker-context-review.md` (versions locales non publiées).

## Sources publiques utiles

- Maison de l’enfance et gestion municipale : https://www.ville-lege44.fr/grandir-et-vieillir/enfance-jeunesse/maison-de-lenfance/
- Espace et vie, point propre de la résidence : https://www.residences-espaceetvie.fr/residences/pornic-loire-atlantique-residences-seniors-44 ; bloc `section_quartier-block`, `data-res="2201"`, latitude/longitude explicites. Les marqueurs des commerces voisins sont distincts.
- Retz accueil, identité publiée : https://retz-accueil.fr/mentions-legales
- Cousteau, adresse physique et contacts : https://www.machecoul-saint-meme.fr/vivre-ici/enfance-jeunesse/les-etablissements-scolaires/
- Villa, numéro 6 confirmé par la collectivité : https://petiteenfance.challansgois.fr/trouver-un-accueil/
- Paz à pas : https://pazapas.fr/mentions-legales-et-politique-de-confidentialite/
- Notre-Dame de Challans, adresse actuellement publiée : https://challans-ecolenotredame.fr/
- Saint-Joseph, adresse et accès : https://ehpad-saint-joseph.net/

Les réponses Annuaire, les extraits Éducation/FINESS, les emprises IGN et les captures postales complètes avaient été conservés localement avec dates et empreintes.

## Découverte complémentaire importante : Saint-Joseph

La recherche initiale laissait le rattachement en attente : FINESS et le site de l’établissement publient le chemin Saint-Joseph, tandis que l’Annuaire indique le 4 route de Pornic pour le SIRET 78592725200011 et le FINESS 440002095.

**Une preuve explicite a ensuite été trouvée, mais son intégration n’a pas commencé avant l’indisponibilité :** la page de l’établissement indique que l’accès au chemin Saint-Joseph se fait par la rue de Pornic. La section « Contact » et le pied de page « Localisation » établissent cette relation. La page a été relue via la recherche web après l’interruption.

Le point public disponible à l’adresse 4 rue de Pornic est 47.11622528, -1.9417729, avec le nom « Residence Saint-Joseph ». Ne pas le retenir par simple proximité : ajouter un modèle générique de preuve d’accès publié, lié au même SIRET/FINESS revalidé, puis contrôler nom, commune, voie d’accès et type.

Les mentions légales de l’établissement confirment aussi explicitement le SIRET 78592725200011 et l’adresse au 4 rue de Pornic : https://ehpad-saint-joseph.net/mentions-legales/ . Cette seconde publication primaire renforce le lien entre les deux accès ; l’intégration dans le résolveur reste à réaliser.

La source contient un lien cartographique propre : https://goo.gl/maps/u9HenXWbS3PmgZrB7 . Ne pas confondre un centre de carte avec les coordonnées du lieu.

## Deux autres positions : points d’entrée municipaux à intégrer

Le modèle local exigeait encore un bâtiment unique démontré pour la résidence Saint-Christophe et Notre-Dame de Challans. Il reste à examiner et intégrer un modèle distinct d’**entrée certifiée par la commune**, plutôt que d’assimiler toute adresse à un géocodage imprécis.

La capture native BAN de `85204_0089_00002` pour le 2 rue du Stade, 85670 Saint-Christophe-du-Ligneron, fournit :
- latitude 46.827347 ; longitude -1.762144 ;
- `type_position: entrée`, `source_position: commune`, `certification_commune: 1`.

Ce modèle n’est **pas implémenté**. Il doit exiger une identité/adresse physique déjà confirmée, la source native complète, une certification communale, un type d’entrée explicite et aucune contradiction de numéro/suffixe/commune. Il doit annoncer une position d’entrée, pas une précision de toit.

Pour Notre-Dame de Challans, l’identifiant BAN de l’adresse est `85047_4740_00015`. La publication de l’école contient aussi un lien Google Maps vers le 15 rue du Capitaine Debouté, avec les coordonnées de lieu 46.8461183, -1.8839267. C’est un point d’adresse : vérifier sa nature et le rattachement physique avant de le proposer.

Le SIRET Éducation 78644886000027 désigne l’UDOGEC à La Roche-sur-Yon et ne doit pas être attribué à l’école. Les anciens établissements 32548690000021 et 32548690000039 au numéro 15 sont fermés. Le SIRET actif 32548690000047 est publié au numéro 21 ; ne pas le déplacer automatiquement au 15.

## Changements de code préparés localement

Nouveaux modules :
- `presentation-conventions.js`, `commune-labels.js` : conventions, libellés officiels des communes 44/85 et anciens noms explicitement reliés par la BAN.
- `administrative-site.js` : une école peut partir d’une adresse de mairie seulement avec une publication de l’école, un UAI ouvert, son SIRET actif, le même SIREN communal et une adresse mairie concordante.
- `official-snapshots.js` : corps HTTP officiels datés, contrôle SHA-256, identifiant/état actif, expiration après 30 jours ; aucune fausse date de consultation.
- `public-poi-cache.js` : observations géographiques locales, sans décisions ni noms ciblés.

Modules modifiés : `enrichment.js`, `enterprise-client.js`, `identity-service.js`, `identity-orchestrator.js`, `identity-resolution.js`, `establishment-position.js`, `establishment-service.js`, `establishment-enrichment-ui.js`, `grist.js`, `contacts-experiment.js`, `public-sites.js`, `named-site-directory.js`, `registry-site-positions.js`, `site-position-sources.js`, `address-building-positions.js`.

Points importants :
- Propositions de présentation même si une recherche d’identité échoue ; aucune identité juridique incertaine importée.
- Remplacements confirmés précochés ; changements probables manuels ; une ancienne position démontrée plus forte n’est pas remplacée par défaut par une preuve plus faible.
- SIRET écrit formaté, comparé sous sa forme de 14 chiffres ; coordonnées et preuves restent atomiques.
- Corrections des doublons existants possibles uniquement pour le même SIRET et le même lieu confirmé ; signalement de l’autre fiche, sans fusion/suppression.
- Affichage numérique coloré ; références repliées, y compris dans le volet contacts.
- L’absence de type dans un POI ne constitue plus une contradiction ; les types explicitement incompatibles restent rejetés.
- Une erreur de UAI sur un objet sans nom/adresse concordants ne doit pas invalider une autre emprise scolaire démontrée.
- Un suffixe de commune est retiré complètement une seule fois, afin de reconnaître les noms après correction et de conserver « Saint-Christophe » lorsqu’il appartient aussi au nom propre.
- Conservation des accents corrects déjà saisis.
- Une raison sociale déjà saisie peut servir de requête de découverte complémentaire ; elle ne constitue pas, seule, une preuve.
- Les sources locales sont examinées ensemble avant les appels distants ; une source distante lente ne masque plus un point déjà démontré.

Données générées localement :
- 76 captures légales datées sous `identity-links/official-snapshots/`.
- 4 423 observations issues de neuf captures postales complètes sous `site-position-indexes/public-pois/`, découpées par code postal/premier chiffre de numéro, max. 256 Kio par fichier.
- Captures postales natives dans `tests/fixtures/context/postcodes/`.
- Nouveaux bâtiments démontrés pour Retz et la Villa ; cohorte IGN Cousteau.
- Captures et scripts : `refresh-official-snapshots.mjs`, `generate-public-poi-cache.mjs`, extension bornée de `generate-address-building-index.mjs`, adaptation de `capture-structure-context-live.mjs`.
- Les fichiers sous `artifacts/` et les recherches sous `../research/v2/` sont intermédiaires, non destinés à être ajoutés intégralement au dépôt.

## État des vérifications

Une suite complète intermédiaire avait passé 543 tests avant les derniers ajouts. Le dernier passage complet exécuté a ensuite rencontré un unique échec de test lié à un nom attendu « Super U » alors que la capture native porte « Super U Machecoul » ; cette assertion a été remplacée par le contrôle des coordonnées historiques. Le fichier de conventions a ensuite passé ses 9 tests, y compris les 25 réanalyses après correction, les captures expirées/altérées et Lourdes avec API indisponible. Les tests Grist ont passé leurs 7 cas après l’ajout du traitement des doublons. Le test de découverte complémentaire par raison sociale a passé son fichier.

**Il reste à relancer toute la suite après les derniers changements**, intégrer et vérifier les nouveaux modèles d’accès/entrée décrits plus haut, puis examiner le diff complet. Ne pas annoncer que tous les derniers tests et la publication sont terminés.

Les données du document Grist ont été relues et confirmées inchangées en fin de travail.

## Reprise et publication

1. Récupérer l’environnement et inspecter `git status` avant toute opération ; si les fichiers ne sont plus disponibles, reconstruire depuis la PR et cette note.
2. Préserver la distinction entre code déjà préparé et modèles d’accès/entrée encore non implémentés.
3. Terminer les preuves et propositions restantes ; vérifier les contre-exemples : mairie/école, mauvais UAI, SSIAD/EHPAD, numéro/suffixe, ancien établissement fermé, gestionnaire/site.
4. Lancer `npm test` et le rejeu des 25 fiches ; vérifier l’interface, la stabilité après correction et l’absence d’écriture pendant l’analyse.
5. Publier le code sur `feat/structure-picker-context-confidence` en contrôlant le nouveau HEAD de #85.
6. Mettre à jour la description de #85 autour du code réellement publié ; laisser la PR en brouillon et ne pas fusionner.
7. Déplacer `preview/structure-picker` vers ce HEAD exact avec contrôle de l’ancienne valeur ; attendre les tests et le déploiement Pages.
8. Vérifier les empreintes des fichiers effectivement servis par la prévisualisation. Ne pas confondre un déploiement lancé avec une version effectivement publiée.
