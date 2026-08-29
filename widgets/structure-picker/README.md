# Assistant Structures

Widget Grist unique pour **rechercher, ajouter et compléter** les structures de stage.

L'interface sépare clairement les deux usages dans deux onglets fixes : **Rechercher / ajouter** et **Compléter la sélection**.

## APIs publiques utilisées

### Annuaire des Entreprises

`https://recherche-entreprises.api.gouv.fr/search`

- recherche des établissements actifs du 44 et du 85 ;
- récupération du SIRET, de la raison sociale, de l'adresse et, lorsqu'elles existent, des coordonnées.

### Géocodage IGN / Géoplateforme

`https://data.geopf.fr/geocodage/search`

- normalisation de l'adresse ;
- latitude et longitude ;
- le code postal et la commune sont dérivés en mémoire de l'adresse afin d'améliorer la recherche Annuaire.

## Mappings Grist

### Obligatoires

- `NomCommercial` → **Nom commercial** ;
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

Latitude et Longitude sont fortement recommandées : l'assistant les remplit lors du géocodage et elles alimentent directement le widget carte des structures de stage.

Téléphone, Courriel et Site web sont disponibles au mapping mais ne sont pas encore recherchés automatiquement sur `develop`.

Il n'existe pas de mapping séparé `Adresse normalisée`, `Code postal` ou `Commune`.

## Interface

Lorsque la configuration est valide, aucun grand message de confirmation n'est affiché. Un petit compteur numérique en haut à droite indique simplement le nombre de structures présentes dans la table ; son infobulle en donne le sens. Les messages de configuration restent visibles uniquement lorsqu'une intervention est utile.

## Rechercher / ajouter

La recherche interroge la table Grist complète puis l'Annuaire des Entreprises pour les établissements actifs du 44/85. Les doublons sont contrôlés par SIREN/SIRET.

## Compléter la sélection

L'onglet **Compléter la sélection** montre l'état du nom commercial, du SIREN/SIRET, de la raison sociale, de l'adresse et des coordonnées carte.

Le bouton **Analyser / compléter** :

1. géocode l'adresse existante si elle existe ;
2. utilise le SIREN/SIRET lorsqu'il est connu, sinon le nom commercial enrichi du code postal/commune dérivés de l'adresse ;
3. propose les établissements et les adresses possibles ;
4. construit un aperçu des modifications ;
5. coche par défaut uniquement les champs actuellement vides ;
6. exige une validation explicite pour remplacer une valeur déjà présente.

Les colonnes formule ne sont jamais écrites. Une proposition vers un champ non mappé ou non modifiable est affichée mais désactivée.

## Prévisualisation develop

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Le dossier conserve son nom historique `structure-picker` pour ne pas casser l'URL déjà configurée dans Grist.

## Tests

```bash
npm test
```
