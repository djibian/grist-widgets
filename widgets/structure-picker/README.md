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

Les deux extraits publiés contiennent les 2 906 établissements géographiques actifs avec SIRET des départements 44 et 85 dans le flux officiel du 2 octobre 2026. Ils sont générés depuis le flux complet, sans liste de noms ou de SIRET de référence. Pour actualiser les données :

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
- `PositionProof` → **Preuves de la position** (JSON avec SIRET, niveau, source et chaîne de preuves) ;
- `Telephone` → **Téléphone** ;
- `Courriel` → **Courriel** ;
- `SiteWeb` → **Site web**.

Latitude et Longitude alimentent la carte. Elles sont proposées ensemble uniquement lorsqu’un point de lieu est démontré pour le SIRET retenu. Mapper aussi Source de la position et Preuves de la position permet de conserver la provenance dans Grist ; elle reste consultable dans le bloc candidat pendant l’analyse.

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

Les sources de position sont les shards publics ATP/Overture du code postal (sans utiliser le classement des contacts), puis, si aucune position n’est démontrée, une seule requête OSM sur `ref:FR:SIRET` exact. La recherche nationale par identifiant évite de joindre un voisin par proximité. Les index actuellement publiés contiennent un sous-ensemble des lieux avec contacts ; un code postal absent ou un lieu non indexé conduit à l’abstention.

Une position est admissible par **SIRET explicite revalidé** (`SITE_CONFIRMED`), sans contradiction de nom public/adresse, ou par **nom propre du lieu exactement égal à un nom public attesté pour ce SIRET et adresse de site concordante** (`SITE_CORROBORATED`). L’attestation provient des enseignes Annuaire ou d’un lien publié revalidé. Commune, code postal, tokens de voie, numéro et répétition doivent concorder ; une voie sans numéro est admise uniquement si les deux sources n’en indiquent aucun. Une marque ou un opérateur partagé par un autre équipement ne remplace pas le nom propre du lieu. Aucun rapprochement par distance, score flou ou score de confiance d’existence Overture ne constitue une preuve de liaison.

Les coordonnées Annuaire et IGN sont conservées comme preuves de référence/découverte, sans devenir la position finale. Deux points de lieux admissibles distants de plus de **75 m** déclenchent `CONFLICT` et l’abstention : ce seuil borne le désaccord entre observations déjà rattachées, il ne sert jamais à associer un POI à un SIRET. Parmi les observations cohérentes, le SIRET explicite prime, puis ATP, OSM, Overture ; les coordonnées ne sont jamais moyennées. Le niveau concerne la liaison au site, sans annoncer une exactitude topographique garantie.

L’identité dispose de **12 s** ; les index de position de **10 s**, puis OSM de **1,5 s** au maximum. Le manifest est préchargé pendant l’examen de la fiche et réutilisé au plus cinq minutes. Un index lent ne fait pas perdre les observations déjà chargées. OSM n’est pas lancé après une position indexée admissible. Le contrôleur borne l’ensemble à **24 s**, annule les requêtes sur changement de sélection et ignore les anciennes réponses.

Les champs juridiques probables restent décochés. Une position s’applique en une paire latitude/longitude et exige le SIRET correspondant dans la fiche ou dans la même action Grist. Les sources/preuves sont écrites dans les mappings facultatifs avec cette paire. L’application relit la fiche et refuse une sélection devenue obsolète. Un résultat Annuaire ajouté depuis la recherche n’insère plus ses coordonnées administratives ; l’analyse de la fiche établit ensuite la position réelle.

Les colonnes formule ne sont jamais écrites. Une proposition vers un champ non mappé ou non modifiable est affichée mais désactivée.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Le dossier conserve son nom historique `structure-picker` pour ne pas casser l’URL déjà configurée dans Grist.

## Tests

```bash
npm run test:structure-picker
```

L’ensemble du dépôt peut également être testé avec `npm test`.
