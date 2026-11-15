# Assistant Structures

Widget Grist unique pour **rechercher, ajouter et compléter** les structures de stage.

L’interface sépare les deux usages principaux dans deux onglets fixes : **Rechercher / ajouter** et **Compléter la sélection**.



### Incrément 8 — retrouver les autres établissements du gestionnaire

Pendant une recherche approfondie, si l'enseignant choisit explicitement le **gestionnaire**
d'un candidat déjà trouvé dans l'Annuaire, le planificateur peut consulter son **SIREN**
afin de découvrir ses autres établissements géographiques. L'indice doit désigner
un candidat effectivement observé et sa dénomination juridique publiée ; une
correction libre, un candidat écarté ou une simple homonymie ne déclenchent pas
ce rattachement. La requête SIREN et les SIRET retournés restent des **pistes
non probantes** : le vérificateur juridique et les protections d'écriture Grist
ne changent pas. Recherche soumise au quota Annuaire et aux filtres géographiques
déjà configurés. Cette amélioration ne prétend pas constituer une validation
indépendante sur les 50+ structures inédites encore à collecter.

### Recherche progressive — chantier #87 / PR #88

La recherche de **Compléter la sélection** exploite maintenant les checkpoints \`onProgress\` et les événements \`onEvent\` déjà émis par les résolveurs. Le panneau présente les pistes disponibles avant le verdict final, cinq à la fois, avec les états réellement observés des sources dans « Activité réelle des sources ». La liste est explicitement **non vérifiée** : un nom, un SIRET ou une adresse simplement repéré n’est jamais une preuve juridique ou géographique et ne crée aucune proposition à appliquer dans Grist. Les propositions restent réservées au verdict final.

Le bouton **Interrompre la recherche** annule les requêtes en cours et garde les pistes visibles ; une relance sur la même fiche inchangée garde ces pistes de découverte en mémoire et réutilise, lorsque le client le permet, son cache de réponses. Une modification de sélection ou des informations de la fiche retire ce contexte. Les événements tardifs d’une analyse terminée ne doivent pas réouvrir le panneau de progression.

**Avancement supplémentaire :** la commande distincte « Approfondir la recherche », proposée après une analyse sans identité juridiquement vérifiée ou après une interruption, déclenche un second passage facultatif. Il recherche des variantes du nom, l’immatriculation existante comme simple indice indépendant, puis élargit la recherche du code postal aux départements configurés. La pagination peut couvrir jusqu’à trois pages additionnelles, dans la limite de 12 requêtes Annuaire et de 28 s pour l’identité / 46 s au total. Le bouton « Analyser / compléter » conserve volontairement son comportement habituel (12 s / 24 s). Les SIRET trouvés restent soumis aux critères de preuve existants ; aucun rattachement géographique nouveau n’est inféré de la proximité ou de la saisie humaine.

**Guidage interactif (incrément 3) :** chaque piste propose des choix indépendants « Nom », « Adresse », « Commune », « Gestionnaire », « SIRET » et « Écarter / Réexaminer ». Un clic mémorise un **indice de recherche non probant**, réversible, sans modifier la fiche. Pendant une recherche ordinaire, le premier choix bascule vers l’approfondissement ciblé en annulant l’ancienne analyse ; les candidats déjà découverts sont conservés. Pendant l’approfondissement, le plan de requêtes est recalculé après chaque consultation Annuaire et intègre les champs nouvellement sélectionnés. Les recherches sont dédupliquées et bornées par le quota déjà en place. Une fiche sélectionnée dans Grist différente invalide ces choix. La sélection humaine ne modifie **jamais** le row utilisé par decideIdentity ni les preuves officielles, et une piste écartée bloque les propositions d’écriture de ce candidat. **Ne pas confondre ce guidage avec la validation définitive des propositions Grist**.

**Limites actuelles :** le guidage porte sur des indices textuels et juridiques de découverte ; la confirmation autonome de position exacte, les contacts et les champs de fiche éditables pendant la recherche restent à construire. L’arrêt adaptatif au-delà des budgets fixes, la simplification des résolveurs, l’enrichissement indépendant des contacts et un corpus de validation indépendant d’au moins 50 nouvelles structures restent obligatoires. Voir l’issue #87. Les tests synthétiques de 50 pistes ne constituent pas une mesure de rappel.


### Incrément 4 — corrections d'indices, consultation étendue et métriques

Les pistes conservées peuvent désormais être affichées par lots supplémentaires de cinq, jusqu'à la limite explicite de 250. Chaque piste possède un volet « Corriger ou préciser une information » (nom, adresse, commune, gestionnaire, SIREN/SIRET). Les corrections sont des **indices de découverte seulement** : elles n'altèrent ni la fiche Grist, ni l'observation officielle, ni les attestations juridiques et géographiques. Une correction identique n'enclenche pas de nouvelle recherche ; un identifiant incomplet ou invalide est refusé. Les corrections restent en mémoire pour une même fiche pendant les relances, mais sont effacées au changement de fiche.

Un calculateur hors ligne de métriques est disponible dans `validation/score-heldout.mjs` (usage et format documentés dans `validation/heldout-evaluation-protocol.md`). Il exige 50 cas réels au moins, dix secteurs et des captures API publiques identiques pour comparer référence et PR. **Aucun corpus réel indépendant n'a encore été constitué et aucun gain mesuré**. Les tests synthétiques du calculateur ne prouvent pas la performance sur les nouvelles structures.

**Limites :** les corrections servent à la recherche Annuaire approfondie et ne remplacent pas la valeur de la fiche servant de référence au vérificateur ; certaines preuves sectorielles déjà concluantes terminent la recherche avant l'exploration d'un indice corrigé. La recherche/ajout initiale, la validation indépendante des positions/contacts, le budget adaptatif et le chantier de simplification restent à compléter. Ne pas prendre une correction humaine pour une preuve permettant d'appliquer un SIRET.

## Départements recherchés

Le périmètre géographique du widget est configurable. Par défaut, un document qui n’a encore enregistré aucune option utilise :

- `44 — Loire-Atlantique` ;
- `85 — Vendée`.

Le bouton **Départements** dans l’en-tête permet de rechercher un département par numéro ou par nom, puis de l’ajouter ou de le retirer. Au moins un département doit rester sélectionné.

La liste est enregistrée dans les **options natives du Custom Widget Grist**. Elle est utilisée immédiatement par les recherches dans l’Annuaire des Entreprises et pour déterminer quels index de contacts peuvent être interrogés.

Les index publiés couvrent actuellement les départements **44 et 85** pour All The Places et Overture Places. Les sources directes OSM, DILA et Wikidata ne dépendent pas de ces index.

## APIs et sources publiques utilisées

### Annuaire des Entreprises

`https://recherche-entreprises.api.gouv.fr/search`

- recherche des établissements actifs dans les départements configurés ;
- revalidation du SIRET, de la raison sociale et de l’adresse ;
- coordonnées conservées comme référence administrative : leur présence ne démontre pas la précision du site.

### FINESS géographique — Agence du Numérique en Santé

Après un verdict probable, le résolveur conserve les `liste_finess` propres à chaque établissement Annuaire et consulte l’extrait du [registre officiel FINESS Structures](https://www.data.gouv.fr/datasets/finess-structures-1) publié avec le widget. Il recherche un identifiant FINESS exact, puis contrôle le SIRET du même enregistrement géographique ; aucun voisin n’est sélectionné.

Une preuve forte exige une entité géographique d’exercice (`EGE`) active, un SIRET complet, un nom public exact après retrait du code postal et de la commune, ainsi qu’une voie, un code postal et une commune concordants avec la fiche et l’Annuaire, sans contradiction de numéro. Le type dans le nom public est conservé et les catégories officielles FINESS sont contrôlées lorsqu’un EHPAD (`500`) ou un SSIAD (`354`) est explicitement demandé : un SSIAD ne confirme pas un EHPAD, même si le nom long reprend celui de l’opérateur. Le SIRET et le rattachement FINESS doivent être revalidés dans une réponse Annuaire fraîche : une réponse officielle datée et encore valide peut être réutilisée ; les captures expirent après 30 jours et conservent leur date de consultation originale. Sinon une requête exacte est nécessaire. Plusieurs preuves suffisantes restent ambiguës.

La phase entière est bornée à huit secondes et au délai d’identité restant, avec deux candidats et deux FINESS par candidat au maximum. Une indisponibilité, un extrait tronqué, un rattachement non unique ou une preuve incompatible conserve l’abstention. Une identité déjà confirmée ne consulte pas FINESS. IGN ne bloque pas un candidat déjà trouvé par nom et adresse.

Le candidat unique conserve la ligne géographique du registre, sa catégorie, les identifiants EGE/FINESS/SIRET, l’adresse, le lien vers la fiche officielle, l’URL et la date du flux source, et la réponse de rattachement Annuaire. Les coordonnées de géocodage d’adresse FINESS/BAN restent dans cette preuve ; elles ne deviennent jamais automatiquement une position démontrée du site.

Les extraits publiés contiennent les 2 906 établissements géographiques actifs avec SIRET des départements 44 et 85 dans le flux officiel du 2 octobre 2026. Ils sont générés depuis le flux complet, sans liste de noms ou de SIRET de référence. Les fichiers sont découpés selon les six premiers caractères du FINESS, avec un plafond de 96 Kio contrôlé à la génération et à la lecture : le navigateur télécharge le petit extrait de l’identifiant recherché plutôt qu’un département complet. Pour actualiser les données :

```sh
python3 scripts/generate-finess-identity-index.py
npm test
```

`--input` accepte un flux officiel téléchargé (`.json` ou `.json.gz`), `--source-url` conserve sa provenance et `--departments` permet d’étendre la couverture. Les secteurs hors couverture restent sans confirmation FINESS. L’Annuaire continue de revalider les établissements actuels à chaque preuve ; un FINESS supprimé ou une contradiction nouvelle invalide le rattachement.

### Géocodage IGN / Géoplateforme

`https://data.geopf.fr/geocodage/search`

- découverte à partir d’une adresse, d’un code postal et d’une commune ;
- point de géocodage conservé comme indice, jamais promu automatiquement en position du site ;
- le code postal et la commune sont dérivés en mémoire de l’adresse afin d’améliorer la recherche Annuaire.

### Contacts publics — moteur actuel et archive

Les étapes **01 · Examiner** et **02 · Vérifier** du mode **Compléter la sélection** proposent déjà le téléphone, le courriel et le site web avec les autres corrections de la fiche. Le parcours expérimental **03–04** a été retiré sans modifier le moteur courant.

Son implémentation, ses cinq sources et ses tests sont conservés dans la branche `archive/structure-picker-contacts-experiment-20261104` (commit `8a3744e8aa553ee6ed97bee5e0a1901f2b0d0db7`). Voir [ARCHIVED-CONTACTS.md](ARCHIVED-CONTACTS.md).

Les index ATP et Overture et `contact-indexes.js` utilisés par la localisation active sont conservés sans modification. La publication de ces index reste décrite dans [CONTACTS-INDEX-PUBLICATION.md](CONTACTS-INDEX-PUBLICATION.md).

## Mappings Grist

### Obligatoires

- `NomCommercial` → **Nom usuel** ;
- `Adresse` → **Adresse** ;
- `SirenSiret` → **SIREN / SIRET**.

Ces champs doivent pointer vers des colonnes de données modifiables.

### Facultatifs

- `RaisonSociale` → **Raison sociale** ;
- `Latitude` → **Latitude** ;
- `Longitude` → **Longitude** ;
- `PositionSource` → **Source de la position** ;
- `PositionProof` → **Preuves de la position** (JSON avec SIRET ou portée de site public, niveau, source et chaîne de preuves) ;
- `Telephone` → **Téléphone** ;
- `Courriel` → **Courriel** ;
- `SiteWeb` → **Site web**.

Latitude et Longitude alimentent la carte. Elles sont proposées ensemble uniquement lorsqu’un point de lieu est démontré pour le SIRET retenu, ou pour un site public explicitement attesté sans identité juridique présumée (voir ci-dessous). Mapper aussi Source de la position et Preuves de la position permet de conserver la provenance dans Grist ; elle reste consultable dans le bloc candidat pendant l’analyse.

Téléphone, Courriel et Site web sont proposés dans **Analyser / compléter** lorsque l’identité de la structure et les sources consultées apportent des informations suffisamment justifiées.

Il n’existe pas de mapping séparé `Adresse normalisée`, `Code postal` ou `Commune`.

## Interface

Lorsque la configuration est valide, aucun grand message de confirmation n’est affiché. Un petit compteur numérique en haut à droite indique le nombre de structures présentes dans la table ; son infobulle en donne le sens. Les messages de configuration restent visibles uniquement lorsqu’une intervention est utile.

L’interface applique l’identité commune **Grist Studio** et les layouts responsive partagés du dépôt.

## Rechercher / ajouter

La recherche interroge la table Grist complète puis l’Annuaire des Entreprises pour les établissements actifs des départements configurés. Les doublons sont contrôlés par SIREN/SIRET.

Le bouton de création manuelle prépare une nouvelle ligne dans Grist ; la saisie elle-même reste effectuée dans la vue Grist.

## Compléter la sélection

L’onglet **Compléter la sélection** montre l’état du nom usuel, du SIREN/SIRET, de la raison sociale, de l’adresse et des coordonnées carte.

Le bouton **Analyser / compléter** résout d’abord l’identité, puis recherche une position de site pour cet établissement. Un seul bloc rassemble nom public, raison sociale, SIRET, adresse, coordonnées éventuelles et sources/preuves. Les verdicts d’identité restent `MATCH_VERIFIED`, `MATCH_PROBABLE`, `AMBIGUOUS`, `NO_MATCH` ou `INCOMPLETE` ; une absence de preuve de position ne dégrade pas une identité confirmée.

`establishment-service.js` compose le résolveur d’identité existant avec `establishment-position.js`. Le contrôleur `establishment-enrichment-ui.js` est l’unique propriétaire du bouton d’analyse et des propositions. `app.js` conserve la recherche, l’ajout et le diagnostic de la fiche.

Les sources de position sont les shards publics ATP/Overture du code postal (sans utiliser le classement des contacts) et, en parallèle après confirmation de l’identité, les [points OSM portant un FINESS géographique](site-position-indexes/osm-finess/README.md). Cet index départemental contient 814 points dans 79 petits fichiers, générés sans liste d’établissements de référence. Le navigateur consulte seulement les préfixes FINESS actifs reliés au SIRET dans FINESS/ANS et une réponse Annuaire fraîche, indépendamment du manifest des codes postaux. Si aucune position n’est démontrée, une seule requête OSM recherche le SIRET exact et ces FINESS revalidés, avec les métadonnées des objets. Aucun voisin n’est joint par proximité. Une couverture absente conserve l’abstention.

Une position est admissible par **SIRET ou FINESS géographique explicite revalidé** (`SITE_CONFIRMED`), sans contradiction de nom public, type, identifiants ou adresse, ou par **nom propre du lieu exactement égal à un nom public attesté pour ce SIRET et adresse de site concordante** (`SITE_CORROBORATED`). L’attestation provient des enseignes Annuaire ou d’un lien publié revalidé. Le FINESS doit désigner un EGE actif du même SIRET et être attesté par l’Annuaire actuel. Un nom abrégé sans catégorie générique est admis uniquement avec ce FINESS exact, la même catégorie FINESS et un type de lieu concordant ; un SSIAD ne fournit pas la position d’un EHPAD. Pour une liaison sans identifiant explicite, commune, code postal, tokens de voie, numéro et répétition doivent concorder ; une voie sans numéro est admise uniquement si les deux sources n’en indiquent aucun. Une marque ou un opérateur partagé par un autre équipement ne remplace pas le nom propre du lieu. Aucun rapprochement par distance, score flou ou score de confiance d’existence Overture ne constitue une preuve de liaison.

Les coordonnées Annuaire, FINESS/BAN et de géocodage IGN sont conservées comme preuves de référence/découverte, sans devenir la position finale. L’index OSM exclut les rues, localités et centres de géométries non ponctuelles. Une contradiction d’identité sur un POI portant le SIRET ou FINESS du candidat déclenche `CONFLICT`, même si une autre observation est correcte ; un voisin portant d’autres identifiants reste simplement rejeté. Deux points de lieux admissibles distants de plus de **75 m** déclenchent aussi l’abstention : ce seuil borne le désaccord entre observations déjà rattachées, il ne sert jamais à associer un POI à un SIRET. Parmi les observations cohérentes, les identifiants explicites priment, puis ATP, OSM, Overture ; les coordonnées ne sont jamais moyennées. Chaque point OSM conserve son identifiant, sa version/date, la date d’extraction et ses tags de source originaux. Le niveau concerne la liaison au site, sans annoncer une exactitude topographique garantie.

L’identité dispose de **12 s** ; les index de position de **10 s**, puis OSM de **1,5 s** au maximum. Le manifest est préchargé pendant l’examen de la fiche et réutilisé au plus cinq minutes. Un index lent ne fait pas perdre les observations déjà chargées. OSM n’est pas lancé après une position indexée admissible. Le contrôleur borne l’ensemble à **24 s**, annule les requêtes sur changement de sélection et ignore les anciennes réponses.

### Adresse officielle → bâtiment BDNB/RNB

L’[index adresse–bâtiment](site-position-indexes/address-buildings/README.md) complète ces sources, en parallèle et sous le même délai. Après `MATCH_VERIFIED`, `address-building-positions.js` exige une adresse numérotée exacte, suffixe inclus, une adresse BAN communale certifiée, une relation BDNB unique et fortement étayée par les données foncières, une construction unique et son identifiant RNB explicite. Le RNB doit être actif/construit et son point publié, ainsi que le point BDNB, doivent appartenir à une même emprise polygonale réelle. Aucun bâtiment n’est recherché ou choisi par distance. Les adresses ambiguës, faibles, incomplètes ou contradictoires restent sans position.

Le point retenu est celui du **bâtiment RNB**, avec le niveau `SITE_CORROBORATED` et une chaîne de preuves propre à cette méthode. Le point BAN d’entrée n’est pas la position finale. Pour POM’ DE RAINETTE, l’adresse `10bis rue des Margotins` relie le SIRET confirmé à la construction BDNB puis au bâtiment RNB `6256NPD4SRW3`, point `46.868617815626294, -1.942076105568997`. Le bâtiment du n°10 sans suffixe, `43H9GCSB54PW`, reste exclu. Le candidat unique affiche la précision de bâtiment et conserve les sources, identifiants, version BDNB, date d’extraction et géométrie RNB dans les preuves.

L’extraction initiale couvre les 20 adresses d’une voie BAN et publie six preuves génériques dans cinq fichiers de moins de 96 Kio ; elle ne contient aucune règle de nom, de SIRET ou d’activité particulière. Le générateur permet d’étendre la couverture à d’autres voies. Il vérifie le schéma BDNB et la pagination effective des API avant de publier. Le navigateur n’appelle jamais ces API de bâtiments : il lit un seul fichier local par code postal/numéro. Une source lente ou hors couverture ne dégrade ni l’identité ni les preuves déjà acquises. Les quatre références sont validées par les tests et le script de capture réseau.

Les champs juridiques probables restent décochés. Une position d’établissement juridique s’applique en une paire latitude/longitude et exige le SIRET correspondant dans la fiche ou dans la même action Grist. Les sources/preuves sont écrites dans les mappings facultatifs avec cette paire. L’application relit la fiche et refuse une sélection devenue obsolète. Un résultat Annuaire ajouté depuis la recherche n’insère plus ses coordonnées administratives ; l’analyse de la fiche établit ensuite la position réelle.

Les colonnes formule ne sont jamais écrites. Une proposition vers un champ non mappé ou non modifiable est affichée mais désactivée.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Le dossier conserve son nom historique `structure-picker` pour ne pas casser l’URL déjà configurée dans Grist.

## Tests

```bash
npm run test:structure-picker
```

L’ensemble du dépôt peut également être testé avec `npm test`.

### Résolution indépendante des sources et référentiels de sites

Le coordinateur conserve les preuves reçues et borne chaque attente, même si le transport ignore `AbortSignal`. Une requête Annuaire dispose de **6,5 s incluant sa file** (espacement de 1,8 s et éventuel backoff), IGN de **1,2 s**, la découverte OSM de **1,5 s**, les liens publiés de **1 s** et le référentiel local de **1,8 s**. L'identité termine avant son garde-fou de 12 s avec un verdict explicite et les informations disponibles. Un échec secondaire ne supprime plus une identité vérifiée. Un arrêt ou changement de sélection interdit toute publication tardive et toute alimentation du cache par une réponse annulée. Les diagnostics affichent les sources, états, durées, budgets, attentes de file et réutilisations du cache.

`official-site-registry.js` effectue la recherche inverse **nom public + adresse de site → identifiant sectoriel → SIRET géographique**, puis exige la revalidation Annuaire actuelle de ce SIRET, de son adresse et de son propre UAI/FINESS. Il n'hérite jamais de l'identité d'un siège ou gestionnaire. Pour les familles scolaires et médico-sociales reconnues, cette source bornée passe avant une recherche Annuaire large : un nom de bâtiment ne doit pas concurrencer son SIRET déjà connu dans la file Annuaire. Les autres recherches gardent leurs voies indépendantes. Les variantes de catégories scolaires restent distinctes ; EHPAD, SSIAD et USLD ne sont pas interchangeables. Le nom propre reste discriminant et les numéros de voie contradictoires dans les preuves de site restent éliminatoires.

Le [catalogue local](identity-links/site-registry/manifest.json) indexe les cohortes départementales complètes disponibles : 1 931 entrées Éducation nationale actives (export de 1 933 lignes) et 2 906 EGE FINESS actifs, dans 446 communes (455 fichiers, moins de 96 Kio chacun). Le navigateur ne charge que les fichiers des communes explicitement désignées. Les champs natifs nécessaires, identifiants, types, dates, précision de localisation et URLs officielles sont conservés. En l'absence de résultat scolaire indexé, une consultation bornée de l'annuaire national au code postal permet de découvrir de nouveaux établissements. Une couverture tronquée ou un rattachement non unique provoque l'abstention, jamais un choix par classement ou distance.

Les UAI peuvent être multisites. L'[index OSM UAI](site-position-indexes/osm-education/) conserve les géométries et versions d'une cohorte de 1 800 objets, sans noms ni SIRET imposés par le générateur. Une emprise n'est admissible que si le UAI est revalidé pour le SIRET du site, le nom et le type concordent, et soit l'adresse propre complète correspond, soit la référence officielle de précision « Numéro de rue » appartient strictement à cette emprise. Ce test de contenance distingue les implantations ; il ne transforme pas le point d'adresse en GPS final. Le point final est strictement intérieur à l'emprise du site. Une position signalée approximative par OSM est refusée. Les centroïdes de boîtes englobantes ne sont plus admis, y compris en repli réseau. Les emprises FINESS portant leurs identifiants propres peuvent également fournir un point intérieur démontré. Une relation complexe sans géométrie démontrable reste exclue.

Le nom usuel et l’adresse commandent la découverte, même lorsqu’un numéro d’immatriculation est renseigné. Ce numéro saisi est un **indice faillible** : s’il concorde avec un candidat déjà étayé, il peut compléter la preuve ; s’il est erroné, absent, mal formé ou appartient au siège, il ne filtre pas les candidats et n’abaisse pas leur verdict. Avec un nom disponible, une capture officielle valide du numéro saisi peut contribuer à la découverte, sans requête distante supplémentaire ni exclusion des autres candidats. Un avertissement explique la divergence. La correction confirmée du numéro existant est proposée **cochée** ; le candidat et sa position sont néanmoins pleinement présentés. Pour une identité juridique, les coordonnées ne peuvent être écrites qu’avec le SIRET correspondant déjà présent ou explicitement sélectionné dans la même action. Les identifiants provenant des sources officielles et le rattachement au site restent contrôlés strictement : la tolérance concerne la saisie de la fiche, pas les preuves.

La normalisation d’adresse conserve une trace des chiffres romains invalides contenant un suffixe de plusieurs `l` minuscules après un préfixe romain en majuscules, lorsqu’ils redeviennent un chiffre romain valide par substitution `l` → `I` (ex. `XXlll` → `XXIII`, `Vll` → `VII`). Elle ne modifie ni un chiffre romain valide, ni un numéro de bâtiment, ni un mot ordinaire, et ne confond pas `XXII` avec `XXIII`. L’original et la transformation figurent dans le certificat d’identité. Ce traitement est générique et ne contient aucun nom d’établissement ou de commune.

Une recherche incomplète peut afficher le site public et son SIRET à revalider, sans proposer de champs juridiques ni de coordonnées. `MATCH_PROBABLE` conserve ses propositions manuelles ; `MATCH_VERIFIED` reste indépendant de la disponibilité d’une position précise.

La régénération se fait par les scripts `generate-site-registry.mjs`, `generate-osm-education-positions.mjs` et `generate-osm-finess-site-geometries.mjs` (ce dernier accepte une réponse OSM complète, ses géométries ou ses nœuds constitutifs et une URL source explicite). Le workflow hebdomadaire **Structure reference snapshot** prépare un artefact validé à examiner ; il ne modifie ni `main` ni une preview à l'insu de leur validation. Les instantanés restent versionnés avec le code publié. Les [preuves de validation](validation/resilient-resolution.md) détaillent les limites de couverture et les contradictions observées sur un corpus indépendant.


## Emprise scolaire IGN et site public sans SIRET démontré

L’[index IGN BD TOPO](site-position-indexes/ign-education/README.md) complète les emprises OSM. Il conserve des cohortes communales complètes et les géométries natives portant les UAI. Le runtime exige le rattachement UAI–SIRET géographique Éducation/Annuaire, un nom, un type, une commune et une adresse concordants, une emprise physique en service issue d’orthophotographie et un point strictement intérieur. Plusieurs UAI sur la même emprise ou une contradiction imposent l’abstention. Le point décrit le site scolaire, pas nécessairement un bâtiment ou une entrée. La précision planimétrique de la frontière IGN ne qualifie pas la précision du point représentatif.

L’[index des annuaires publics](identity-links/public-sites/README.md) résout un autre cas : une collectivité atteste explicitement un lieu et son propre point cartographique, alors qu’aucun SIRET propre au site n’est établi. Le domaine de la collectivité doit être attesté par Service-Public/DILA ; la fiche doit publier le nom, l’adresse et exactement un marqueur nommé. Le runtime exige un nom normalisé exact, une voie compatible et la même commune. Il ne rattache aucun POI voisin ni identifiant de gestionnaire.

Le candidat reste unique et porte `identityScope: PUBLIC_SITE`, `siteId` (URL stable de fiche), `siret: null`, aucune raison sociale présumée et la preuve native datée. Une raison sociale de gestionnaire peut être proposée séparément lorsqu’une publication municipale établit la gestion du service et que son identité communale est revalidée ; le SIRET du gestionnaire reste explicitement distinct du SIRET propre du lieu. `MATCH_VERIFIED` atteste ici **le site public**, pas une identité juridique. L’UI affiche explicitement cette portée et l’absence de SIRET propre ; le point est présenté comme publié par la collectivité, d’exactitude métrique non documentée. Une contradiction juridique pertinente ou plusieurs sites concordants empêchent cette confirmation.

Pour cette portée uniquement, la paire de coordonnées et ses preuves peut être écrite sans SIRET : la fiche doit être inchangée à la relecture, conserver le même nom/adresse et ne porter aucun numéro juridique. La preuve native, la portée, l’identifiant de fiche et les deux coordonnées sont revérifiés ; les autres valeurs cochées sont contrôlées contre la publication du lieu et ses conventions de présentation. Un identifiant de gestionnaire ne peut pas être attribué au lieu dans cette action. Les règles SIRET restent intactes pour les candidats juridiques. Les colonnes facultatives de provenance conservent la portée et la chaîne de preuves lorsqu’elles sont mappées.

La découverte d’un site public est indépendante et bornée ; une preuve complète peut terminer le pipeline et annuler les appels devenus inutiles. Les générateurs traitent des cohortes sans liste de noms cibles. L’extension des territoires et des formats de publication reste explicite ; la couverture n’est pas automatiquement nationale. Voir les [preuves et résultats Alliance/Legé](validation/official-site-location.md), le [rejeu des neuf fiches](validation/official-sites-live-summary.json) et les [réponses primaires](validation/official-sites-public-responses.json).


## Conventions et sélection des améliorations

Le nom usuel suit `Nom en casse de phrase — Commune`, avec conservation des accents et des initiales de marque isolées (`Super U`). La commune est systématique : cette convention stable désambiguïse aussi les homonymes non encore présents dans le document. Elle ne dépend pas d’un recensement national exhaustif des noms. Les raisons sociales conservent la dénomination du registre.

L’adresse suit `numéro [bis/ter] type de voie Nom propre, code postal Commune`. Les abréviations courantes sont développées, les particules restent minuscules, les chiffres romains sont préservés. Les mentions BP/CS/CEDEX sont retirées de l’adresse physique ; une zone d’activité redondante est omise lorsqu’un numéro et une voie existent. Un numéro ou suffixe saisi plus précis n’est pas supprimé pour aligner une source incomplète. Les accents déjà corrects sont préservés.

Le SIRET est présenté et écrit sous la forme `123 456 789 00012` ; un SIREN reste `123 456 789`. Les comparaisons d’identité utilisent uniquement les chiffres. Les téléphones français suivent `02.40.00.00.00`, notamment lors de l’ajout d’une fiche.

Chaque différence de présentation devient une proposition. Les améliorations confirmées, même sur un champ déjà renseigné, sont cochées par défaut. Les changements d’identité probables restent manuels. Une position actuelle déjà démontrée n’est pas précochée pour être remplacée par une proposition plus faible. Seul le bouton d’application écrit dans Grist, après relecture de la fiche et contrôle des colonnes modifiables.

La correction d’un doublon existant peut conserver un SIRET déjà présent lorsque l’identité est confirmée, que le nom et l’adresse désignent le même lieu et que la fiche analysée est inchangée. L’autre fiche est signalée ; aucune fusion ni suppression n’a lieu. L’ajout d’une nouvelle fiche et les numéros appartenant à un autre lieu restent protégés contre les doublons.

`administrative-site.js` distingue une adresse de mairie d’une implantation scolaire : publication du lieu, UAI ouvert, SIRET propre à l’école, même SIREN communal et adresse saisie correspondant à l’établissement mairie sont tous requis. Un simple domaine de courriel municipal ne suffit pas. Les noms normalisés restent reconnaissables lors d’une nouvelle analyse ; la commune est retirée comme suffixe complet, sans effacer un nom propre partagé avec celle-ci.

Les captures géographiques locales sont traitées avec les autres preuves locales avant les services distants. Elles ne constituent pas des décisions et ne contiennent aucun résultat attendu. Les réponses légales récentes résistent à une indisponibilité ponctuelle de la recherche distante. L’affichage principal utilise un indice numérique coloré ; les références de vérification restent repliées. L’indice est ordinal et ne représente pas une probabilité.

Les [résultats des 25 fiches](../../docs/structure-picker-context-review.md) documentent aussi les points d’entrée certifiés, les accès publiés et les immatriculations restant non établies.


Les accès alternatifs d’un même lieu sont admis uniquement lorsque l’exploitant publie son SIRET exact, l’adresse enregistrée et le lien d’accès depuis l’adresse physique. Le SIRET doit encore être revalidé actif ; la voie, le numéro, la commune et les extraits natifs sont contrôlés. Une simple proximité ne suffit jamais.

Le repli `certified-entrances.js` admet un point natif BAN de type `entrée`, publié par la commune et certifié, uniquement à l’adresse physique complète d’un lieu déjà confirmé. L’identifiant BAN, le numéro et le suffixe doivent être cohérents. Il intervient après les preuves de lieu/bâtiment et ne remplace pas une position plus forte. Les coordonnées représentent une entrée publiée, sans précision de toit ni exactitude métrique présumée. Les preuves publiques sont revérifiées lors de l’écriture dans Grist. Régénération : `node scripts/generate-certified-entrances.mjs /chemin/building-*.json`, depuis des captures d’adresses complètes.


### Recherche autonome par adresse de voie (PR #88, incrément 5)

Lors d'un **approfondissement volontaire**, le planificateur peut interroger l'API publique Annuaire des entreprises par **adresse de voie indépendamment de la dénomination**. Il retire le code postal de `q` et l'applique comme filtre : la recherche d'adresse postale est tentée avant la relaxation des noms. La recherche par voie sans filtre postal intervient ensuite, sous les mêmes budgets et départements configurés ; une saisie corrigée par l'enseignant passe en premier sans effacer l'adresse de la fiche originale.

Les valeurs d'adresse issues de ces recherches sont exclusivement des **pistes**. Elles n'entraînent aucune confirmation juridique, aucun déplacement de site et aucune écriture Grist : le vérificateur `decideIdentity`, les protections de sélection et les validations d'écriture restent inchangés. Les adresses trop vagues (commune seule, code postal seul) ne génèrent pas de requête de voie. Le dédoublonnage d'URL, la limitation Annuaire et la reprise du plan entre réponses sont préservés.

Source documentaire publique du mode de recherche par adresse et quotas : https://recherche-entreprises.api.gouv.fr/docs/ . **Limites :** le périmètre départemental demeure configuré dans le widget ; aucun gain de rappel n'est encore établi sur un corpus inédit indépendant. La fonctionnalité doit encore être validée en situation réelle dans Grist.

### Classement de découverte (PR #88, incrément 6)

La liste **Pistes à explorer** classe désormais les candidats **pour l'affichage uniquement** à partir de la ressemblance générique des noms (enseigne, dénomination, variantes), de la voie, du code postal, de la commune et, très faiblement, d'un SIRET saisi comme indice non fiable. Une correction humaine remplace les indices de recherche et re-classe immédiatement les pistes, **sans modifier la fiche Grist source**. Un score élevé ne certifie **ni un site, ni son SIRET, ni ses coordonnées** et ne participe jamais à `decideIdentity` ni aux propositions d'écriture.

Les candidats restent inspectables après un verdict ambigu ou incomplet, même si le vérificateur présente déjà des alternatives. L'interface conserve au plus 250 pistes distinctes ; si ce réservoir borné est plein, une nouvelle piste mieux classée peut remplacer l'une des moins pertinentes, sans qu'aucune identité soit validée par ce classement. La valeur `totalHintsSeen` est un **minimum observé**, pas un inventaire exhaustif de tous les candidats lorsque la recherche dépasse cette limite. Le classement est une heuristique déterministe non calibrée : **aucun gain de rappel@5 ne peut être revendiqué avant le corpus indépendant gelé** décrit dans `validation/heldout-evaluation-protocol.md`.


## Classement des pistes : code postal et commune confirmée

Le classement des pistes de découverte est **indicatif et distinct de la preuve juridique**.
Il compare séparément la voie (sans le code postal ni la commune), le code postal
et la commune : une correspondance de code postal ne doit jamais être confondue
avec une correspondance de rue. Si l'enseignant confirme explicitement une
commune, le code postal issu de l'ancienne adresse n'est plus utilisé pour
déclasser les candidats de cette commune ; les deux établissements homonymes
restent consultables. Ce choix **n'entraîne aucune vérification officielle de
SIRET, aucun géocodage certifié et aucune écriture Grist**.

Tests adversariaux : `tests/discovery-progress.test.mjs`
(codes postaux seuls, commune confirmée en contradiction avec l'adresse).

### Recherche des établissements d'un gestionnaire — correction API (PR #88)

**Comportement documenté de l'Annuaire** : une requête directe avec `q` composé
exactement de 9 chiffres (SIREN) ou de 14 chiffres (SIRET) ignore les filtres
géographiques ; elle ne fournit pas la liste `matching_etablissements` d'une
recherche textuelle ordinaire. Il est donc erroné d'utiliser une requête directe
par SIREN pour énumérer les établissements « frères » d'un gestionnaire.
Références :
https://recherche-entreprises.api.gouv.fr/docs/ et
https://forum.data.gouv.fr/t/api-recherche-d-entreprises-peut-on-obtenir-la-liste-des-etablissements-a-partir-du-siren/815
(réponse officielle du 4 mai 2026).

Lorsqu'un enseignant sélectionne le gestionnaire d'un candidat réel publié
par l'Annuaire (nom légal exact non modifié, identifiants de ce candidat
cohérents, piste non écartée), l'approfondissement effectue désormais une
**recherche textuelle par sa dénomination officielle**, ciblée d'abord sur le
**code postal du site de stage**, puis étendue aux **départements configurés**
sans filtre postal. Ces deux requêtes et les variantes ultérieures partagent
le même mécanisme de dédoublonnage, de quota, d'annulation et de reprise.
Le SIREN du gestionnaire n'est **jamais** attribué comme SIRET au site ;
un établissement trouvé reste un candidat soumis au vérificateur juridique
`decideIdentity`. Le changement ne modifie ni les règles de preuve, ni les
positions certifiées, ni les écritures/ACL Grist.

Limite : cette recherche peut échouer pour une entité dont la dénomination
légale n'apparaît pas dans les résultats textuels ou dont les établissements
sont hors des départements configurés. Aucun gain de rappel@5 indépendant n'est
encore quantifié.
