# Assistant Structures

Widget Grist unique pour **rechercher, ajouter et compléter** les structures de stage.

L'interface est organisée en deux onglets fixes afin de séparer clairement les deux tâches de l'utilisateur sans exposer les outils techniques sous-jacents.

## Interface

### Rechercher / ajouter

Onglet ouvert par défaut. Il contient dans un même flux :

1. le champ de recherche ;
2. les structures déjà enregistrées dans la table Grist complète ;
3. les établissements actifs du 44 et du 85 trouvés dans l'Annuaire des Entreprises ;
4. en dernier recours, la création manuelle.

Le champ de recherche et ses résultats ne sont donc jamais séparés par le panneau d'enrichissement.

### Compléter la sélection

Cet onglet suit la ligne sélectionnée dans Grist. Il affiche le diagnostic du nom commercial, du SIREN/SIRET, de la raison sociale, de l'APE/NAF, de l'adresse et des coordonnées carte.

Un badge sur l'onglet indique le nombre d'informations manquantes détectées. Aucun changement d'onglet n'est imposé automatiquement : l'utilisateur garde la maîtrise de son parcours.

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

## Enrichissement de la structure sélectionnée

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
