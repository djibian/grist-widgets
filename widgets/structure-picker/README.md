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
- récupération du SIRET, de la raison sociale, de l’adresse et, lorsqu’elles existent, des coordonnées.

### Géocodage IGN / Géoplateforme

`https://data.geopf.fr/geocodage/search`

- normalisation de l’adresse ;
- latitude et longitude ;
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
- `Telephone` → **Téléphone** ;
- `Courriel` → **Courriel** ;
- `SiteWeb` → **Site web**.

Latitude et Longitude sont fortement recommandées : l’assistant les remplit lors du géocodage et elles alimentent directement le widget carte des structures de stage.

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

Le bouton **Analyser / compléter** :

1. géocode l’adresse existante si elle existe ;
2. utilise le SIREN/SIRET lorsqu’il est connu, sinon le nom usuel enrichi du code postal/commune dérivés de l’adresse ;
3. propose les établissements et les adresses possibles ;
4. construit un aperçu des modifications ;
5. coche par défaut uniquement les champs actuellement vides ;
6. exige une validation explicite pour remplacer une valeur déjà présente.

Les colonnes formule ne sont jamais écrites. Une proposition vers un champ non mappé ou non modifiable est affichée mais désactivée.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Le dossier conserve son nom historique `structure-picker` pour ne pas casser l’URL déjà configurée dans Grist.

## Tests

```bash
npm run test:structure-picker
```

L’ensemble du dépôt peut également être testé avec `npm test`.
