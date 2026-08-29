# Structure Picker

Widget Grist pour retrouver une structure de stage dans la totalité de la table Grist puis, si nécessaire, découvrir des établissements officiels actifs en Loire-Atlantique (44) et Vendée (85) via l'API Recherche d'Entreprises de la DINUM.

## Principe

Le widget utilise la même API publique que le widget betagouv `codeSiren` disponible dans la collection française de widgets Grist :

`https://recherche-entreprises.api.gouv.fr/search`

Le widget betagouv recherche surtout un SIREN à partir d'un nom. `Structure Picker` recherche un établissement précis, exploite le SIRET et peut créer la structure dans Grist.

## V1

1. La recherche locale utilise `grist.docApi.fetchTable()` : elle porte sur la **table complète**, même si la vue Grist est filtrée.
2. La recherche locale est floue : accents, ponctuation, préfixes et petites fautes de frappe sont tolérés.
3. La recherche externe utilise `departement=44,85` et ne conserve que les établissements actifs du 44/85.
4. Le nom commercial et la raison sociale sont conservés séparément.
5. Un seul mapping `SIREN / SIRET` est utilisé. Une valeur de 9 chiffres est interprétée comme un SIREN ; une valeur de 14 chiffres comme un SIRET. Lors d'un nouvel ajout, le widget écrit le SIRET, plus précis.
6. Le code postal et la commune ne sont pas mappés : ils sont extraits en mémoire de l'adresse normalisée pour la recherche locale. Pour un résultat DINUM, ils proviennent directement de l'API.
7. Avant chaque ajout, la table complète est relue. Après création, une seconde lecture détecte une éventuelle course entre deux utilisateurs.
8. Les métadonnées de colonnes Grist sont contrôlées avant écriture. Une colonne calculée facultative est ignorée ; une colonne calculée utilisée comme destination obligatoire bloque l'ajout avec un message explicite.
9. Les réponses externes sont mises en cache pour la session. Les appels sont temporisés, espacés, annulables et les réponses HTTP 429 respectent `Retry-After`.
10. La création manuelle reste disponible lorsque l'Annuaire ne retrouve pas une enseigne ou une formulation usuelle.

Aucune donnée du document Grist n'est envoyée à l'API externe. Seul le texte saisi dans le champ de recherche est transmis.

## Mappings Grist

Les intitulés indiquent volontairement le rôle de chaque champ.

### Obligatoires — recherche + écriture

- `NomCommercial` → **Nom commercial — recherche + écriture**. C'est le nom principal affiché par le widget.
- `Adresse` → **Adresse — recherche + écriture**. C'est la colonne de données dans laquelle l'adresse d'un nouvel établissement est enregistrée.
- `SirenSiret` → **SIREN / SIRET — recherche + écriture**. Un seul champ suffit.

Ces trois mappings doivent pointer vers des **colonnes de données modifiables**, pas vers des colonnes formule.

### Facultatif — recherche uniquement

- `AdresseNormalisee` → **Adresse normalisée — recherche uniquement**. Le widget ne tente jamais d'y écrire. Elle peut donc être produite par le géocodeur ou être une colonne calculée. Le code postal et la commune sont extraits automatiquement de cette adresse pour enrichir la recherche.

### Facultatif — recherche + écriture

- `RaisonSociale` → **Raison sociale — recherche + écriture**.

### Facultatifs — écriture uniquement

- `APE` → code APE / NAF ;
- `Latitude` ;
- `Longitude`.

Si l'un de ces champs facultatifs est mappé vers une colonne formule, il est simplement ignoré lors de l'ajout et le widget affiche un avertissement.

## Nom commercial

Le nom commercial est le nom principal du widget. L'API ne fournit pas toujours une enseigne distincte. Dans ce cas, la raison sociale est utilisée comme nom affichable de repli afin que la structure puisse malgré tout être ajoutée.

## SIREN / SIRET et dédoublonnage

Le champ unique peut contenir :

- 9 chiffres : SIREN ;
- 14 chiffres : SIRET.

Un nouvel établissement est enregistré avec son SIRET. Pour les anciennes lignes qui ne contiennent qu'un SIREN, le widget considère tout établissement portant ce même SIREN comme déjà connu. C'est un choix conservateur destiné à éviter les doublons.

Le widget protège aussi contre les ajouts concurrents : verrou dans le navigateur, relecture juste avant création et réconciliation après création. Cela ne remplace toutefois pas une contrainte transactionnelle d'unicité imposée au niveau du document Grist.

## API externe

API Recherche d'Entreprises de la DINUM :

- publique et sans clé ;
- recherche textuelle ou SIREN/SIRET ;
- filtre API `departement=44,85` ;
- établissements actifs uniquement ;
- contrôle local du département après réponse ;
- pas de Google, pas d'API Entreprise avec jeton, pas d'index SIRENE local.

## Prévisualisation `develop`

GitHub Pages publie la branche de développement pendant la phase de test :

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

## Tests

Depuis la racine du dépôt :

```bash
npm test
```

Les mêmes tests sont exécutés par GitHub Actions sur `develop` et sur les pull requests concernées.
