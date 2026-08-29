# Assistant Structures

Widget Grist unique pour **rechercher, ajouter et compléter** les structures de stage.

L'interface évite d'exposer plusieurs outils techniques : la recherche reste en haut et la structure actuellement sélectionnée est analysée en dessous. L'utilisateur peut ensuite compléter son identité officielle et sa localisation, avec aperçu avant écriture.

## APIs publiques utilisées

### Annuaire des Entreprises

`https://recherche-entreprises.api.gouv.fr/search`

- même API que le widget betagouv `codeSiren` ;
- recherche des établissements actifs du 44 et du 85 ;
- récupération du SIRET, de la raison sociale, du code APE/NAF, de l'adresse et, lorsqu'elles existent, des coordonnées.

### Géocodage IGN / Géoplateforme

`https://data.geopf.fr/geocodage/search`

- normalisation de l'adresse ;
- latitude et longitude ;
- le code postal et la commune sont utilisés en mémoire pour améliorer la recherche Annuaire.

## Mappings Grist

### Obligatoires

- `NomCommercial` → **Nom commercial — recherche + écriture** ;
- `Adresse` → **Adresse — recherche + géocodage + écriture** ;
- `SirenSiret` → **SIREN / SIRET — recherche + écriture**.

Ces champs doivent pointer vers des colonnes de données modifiables.

### Facultatifs

- `RaisonSociale` → raison sociale ;
- `APE` → code APE / NAF ;
- `Latitude` → latitude ;
- `Longitude` → longitude.

**Latitude et Longitude sont fortement recommandées** : l'assistant les remplit lors du géocodage et elles alimentent directement le widget carte des structures de stage.

Il n'existe plus de mapping séparé `Adresse normalisée`, `Code postal` ou `Commune`. Le champ `Adresse` est l'unique adresse : lorsqu'une adresse géocodée est validée, elle remplace explicitement l'adresse actuelle.

## Rechercher / ajouter

La recherche interroge la table Grist complète puis l'Annuaire des Entreprises pour les établissements actifs du 44/85. Les doublons sont contrôlés par SIREN/SIRET.

## Compléter la structure sélectionnée

Le panneau **Structure sélectionnée** montre l'état du nom commercial, du SIREN/SIRET, de la raison sociale, de l'APE/NAF, de l'adresse et des coordonnées carte.

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

Le dossier conserve son nom historique `structure-picker` pour ne pas casser l'URL déjà configurée dans Grist ; l'interface et la fonction du widget sont désormais celles d'**Assistant Structures**.

## Tests

```bash
npm test
```
