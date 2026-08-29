# Structure Picker

Widget Grist pour retrouver une structure de stage dans la totalité de la table Grist puis, si nécessaire, découvrir des établissements officiels actifs en Loire-Atlantique (44) et Vendée (85) via l'API Recherche d'Entreprises de la DINUM.

## V1

1. La recherche locale utilise `grist.docApi.fetchTable()` : elle porte sur la **table complète**, même si la vue Grist est filtrée.
2. La recherche locale est floue : accents, ponctuation, préfixes et petites fautes de frappe sont tolérés.
3. La recherche externe interroge `https://recherche-entreprises.api.gouv.fr/search` avec `departement=44,85` et ne conserve que les établissements actifs du 44/85.
4. Nom commercial/enseigne, raison sociale, SIREN et SIRET restent distincts.
5. Un SIRET déjà présent dans la table complète n'est pas reproposé comme nouvelle structure.
6. Avant chaque ajout, la table complète est relue. Après création, une seconde lecture détecte une éventuelle course entre deux utilisateurs ; si une ligne identique existait déjà, le widget supprime uniquement la ligne qu'il vient de créer et sélectionne l'existante.
7. La ligne existante ou créée est automatiquement sélectionnée dans Grist.
8. Le widget reste bloqué tant que `Nom`, `Adresse` et `SIRET` ne sont pas mappés.
9. Les réponses externes sont mises en cache pour la session. Les appels sont temporisés, espacés, annulables et les réponses HTTP 429 respectent `Retry-After`.
10. La création manuelle reste disponible lorsque l'Annuaire ne retrouve pas une enseigne ou une formulation usuelle.

Aucune donnée du document Grist n'est envoyée à l'API externe. Seul le texte saisi dans le champ de recherche est transmis.

## Colonnes Grist

### Indispensables

- `Nom` : nom affiché dans la table ;
- `Adresse` : adresse de l'établissement ;
- `SIRET` : identifiant de l'établissement.

### Optionnelles

- `NomCommercial` : enseigne ou nom commercial ;
- `RaisonSociale` ;
- `SIREN` ;
- `CodePostal` ;
- `Commune` ;
- `APE` ;
- `Latitude` ;
- `Longitude` ;
- `AdresseNormalisee`.

Lors d'un ajout externe, seules les colonnes effectivement mappées sont renseignées.

## Accès Grist

Le widget demande l'accès `full` car il doit lire la table complète, créer une ligne, éventuellement supprimer sa propre ligne en cas de course concurrente, et déplacer le curseur.

## Dédoublonnage et concurrence

Le widget protège fortement contre les ajouts concurrents par SIRET : verrou dans le navigateur, relecture juste avant création et réconciliation après création.

Ce mécanisme n'est toutefois pas une contrainte d'unicité transactionnelle imposée par Grist. Pour une garantie absolue entre plusieurs navigateurs même en cas de coupure réseau au mauvais instant, il faut ajouter dans le document une règle d'accès Grist interdisant les doublons de SIRET. Grist documente ce mécanisme avec une colonne de comptage des doublons et une règle ACL refusant une création lorsque le compteur dépasse 1.

## API externe

API Recherche d'Entreprises de la DINUM :

- publique et sans clé ;
- recherche textuelle ou SIREN/SIRET ;
- filtre API `departement=44,85` ;
- filtre API unité légale active et contrôle supplémentaire de l'état de chaque établissement ;
- contrôle local du département après réponse, car une recherche directe par SIREN/SIRET peut ignorer les filtres API ;
- pas de Google, pas d'API Entreprise avec jeton, pas d'index SIRENE local.

## Prévisualisation de `develop`

Canal HTTPS de développement :

`https://cdn.jsdelivr.net/gh/djibian/grist-widgets@develop/widgets/structure-picker/index.html`

Pour un test parfaitement reproductible, préférer une URL jsDelivr figée sur le SHA du commit à tester.

## Tests

Depuis la racine du dépôt :

```bash
npm test
```

Les mêmes tests sont exécutés par GitHub Actions sur `develop` et sur les pull requests concernées.
