# Assistant Structures

Widget Grist unique pour **rechercher, ajouter et compléter** les structures de stage.

L’interface sépare les deux usages principaux dans deux onglets fixes : **Rechercher / ajouter** et **Compléter la sélection**.

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

Une preuve forte exige une entité géographique d’exercice (`EGE`) active, un SIRET complet, un nom public exact après retrait du code postal et de la commune, ainsi qu’une voie, un code postal et une commune concordants avec la fiche et l’Annuaire, sans contradiction de numéro. Le type dans le nom public est conservé et les catégories officielles FINESS sont contrôlées lorsqu’un EHPAD (`500`) ou un SSIAD (`354`) est explicitement demandé : un SSIAD ne confirme pas un EHPAD, même si le nom long reprend celui de l’opérateur. Le SIRET et le rattachement FINESS doivent être revalidés dans une réponse Annuaire fraîche : la réponse initiale est réutilisée si elle ne vient pas du cache, sinon une requête SIRET exacte est nécessaire. Plusieurs preuves suffisantes restent ambiguës.

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

### Contacts publics — expérimental

La zone **Contacts publics** recherche facultativement Téléphone, Courriel et Site web à partir de cinq sources :

- **OpenStreetMap / Overpass** — interrogation directe, avec priorité au SIRET exact puis proximité + nom ;
- **Service-Public.fr (DILA)** — interrogation directe de l’Annuaire de l’administration ;
- **Wikidata** — interrogation directe par SIREN lorsque possible, sinon par nom ;
- **All The Places** — index statique publié avec le widget ;
- **Overture Places** — index statique publié avec le widget.

ATP et Overture sont préparés hors navigateur puis découpés par code postal. Une recherche ne charge que les shards nécessaires à la structure sélectionnée.

Les résultats passent tous par le même modèle canonique, la même déduplication et le même classement. Les provenances sont conservées, et les lignées connues entre sources ne sont pas comptées comme des preuves indépendantes.

Cette fonction reste explicitement **expérimentale** tant que la qualité de ses correspondances n’a pas été suffisamment évaluée sur des structures réelles. Elle ne bloque jamais les fonctions stables Annuaire/IGN et n’écrit aucune donnée sans validation explicite.

Voir `CONTACTS-EXPERIMENT.md` pour l’architecture et `CONTACTS-INDEX-PUBLICATION.md` pour la publication des index.

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

Téléphone, Courriel et Site web sont utilisés uniquement par la fonction expérimentale **Contacts publics** ; ils ne font pas partie de l’enrichissement stable effectué par **Analyser / compléter**.

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

Le nom usuel et l’adresse commandent la découverte, même lorsqu’un numéro d’immatriculation est renseigné. Ce numéro saisi est un **indice faillible** : s’il concorde avec un candidat déjà étayé, il peut compléter la preuve ; s’il est erroné, absent, mal formé ou appartient au siège, il ne filtre pas les candidats et n’abaisse pas leur verdict. Avec un nom disponible, il ne déclenche pas non plus de requête qui retarderait cette recherche. Un avertissement explique la divergence. La correction du numéro existant est proposée **décochée** ; le candidat et sa position sont néanmoins pleinement présentés. Pour une identité juridique, les coordonnées ne peuvent être écrites qu’avec le SIRET correspondant déjà présent ou explicitement sélectionné dans la même action. Les identifiants provenant des sources officielles et le rattachement au site restent contrôlés strictement : la tolérance concerne la saisie de la fiche, pas les preuves.

La normalisation d’adresse conserve une trace des chiffres romains invalides contenant un suffixe de plusieurs `l` minuscules après un préfixe romain en majuscules, lorsqu’ils redeviennent un chiffre romain valide par substitution `l` → `I` (ex. `XXlll` → `XXIII`, `Vll` → `VII`). Elle ne modifie ni un chiffre romain valide, ni un numéro de bâtiment, ni un mot ordinaire, et ne confond pas `XXII` avec `XXIII`. L’original et la transformation figurent dans le certificat d’identité. Ce traitement est générique et ne contient aucun nom d’établissement ou de commune.

Une recherche incomplète peut afficher le site public et son SIRET à revalider, sans proposer de champs juridiques ni de coordonnées. `MATCH_PROBABLE` conserve ses propositions manuelles ; `MATCH_VERIFIED` reste indépendant de la disponibilité d’une position précise.

La régénération se fait par les scripts `generate-site-registry.mjs`, `generate-osm-education-positions.mjs` et `generate-osm-finess-site-geometries.mjs` (ce dernier accepte une réponse OSM complète, ses géométries ou ses nœuds constitutifs et une URL source explicite). Le workflow hebdomadaire **Structure reference snapshot** prépare un artefact validé à examiner ; il ne modifie ni `main` ni une preview à l'insu de leur validation. Les instantanés restent versionnés avec le code publié. Les [preuves de validation](validation/resilient-resolution.md) détaillent les limites de couverture et les contradictions observées sur un corpus indépendant.


## Emprise scolaire IGN et site public sans SIRET démontré

L’[index IGN BD TOPO](site-position-indexes/ign-education/README.md) complète les emprises OSM. Il conserve des cohortes communales complètes et les géométries natives portant les UAI. Le runtime exige le rattachement UAI–SIRET géographique Éducation/Annuaire, un nom, un type, une commune et une adresse concordants, une emprise physique en service issue d’orthophotographie et un point strictement intérieur. Plusieurs UAI sur la même emprise ou une contradiction imposent l’abstention. Le point décrit le site scolaire, pas nécessairement un bâtiment ou une entrée. La précision planimétrique de la frontière IGN ne qualifie pas la précision du point représentatif.

L’[index des annuaires publics](identity-links/public-sites/README.md) résout un autre cas : une collectivité atteste explicitement un lieu et son propre point cartographique, alors qu’aucun SIRET propre au site n’est établi. Le domaine de la collectivité doit être attesté par Service-Public/DILA ; la fiche doit publier le nom, l’adresse et exactement un marqueur nommé. Le runtime exige un nom normalisé exact, une voie compatible et la même commune. Il ne rattache aucun POI voisin ni identifiant de gestionnaire.

Le candidat reste unique et porte `identityScope: PUBLIC_SITE`, `siteId` (URL stable de fiche), `siret: null`, aucune raison sociale présumée et la preuve native datée. `MATCH_VERIFIED` atteste ici **le site public**, pas une identité juridique. L’UI affiche explicitement cette portée et l’absence de SIRET propre ; le point est présenté comme publié par la collectivité, d’exactitude métrique non documentée. Une contradiction juridique pertinente ou plusieurs sites concordants empêchent cette confirmation.

Pour cette portée uniquement, la paire de coordonnées et ses preuves peut être écrite sans SIRET : la fiche doit être inchangée à la relecture, conserver le même nom/adresse et ne porter aucun numéro juridique. La preuve native, la portée, l’identifiant de fiche et les deux coordonnées sont revérifiés ; aucun autre champ ni identifiant juridique ne peut être ajouté dans cette action. Les règles SIRET restent intactes pour les candidats juridiques. Les colonnes facultatives de provenance conservent la portée et la chaîne de preuves lorsqu’elles sont mappées.

La découverte d’un site public est indépendante et bornée ; une preuve complète peut terminer le pipeline et annuler les appels devenus inutiles. Les générateurs traitent des cohortes sans liste de noms cibles. L’extension des territoires et des formats de publication reste explicite ; la couverture n’est pas automatiquement nationale. Voir les [preuves et résultats Alliance/Legé](validation/official-site-location.md), le [rejeu des neuf fiches](validation/official-sites-live-summary.json) et les [réponses primaires](validation/official-sites-public-responses.json).
