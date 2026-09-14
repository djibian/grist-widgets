# grist-widgets

Collection de widgets personnalisés pour Grist.

La branche `main` est l’unique branche permanente, la référence du projet et la source publiée par GitHub Pages. Chaque widget vit dans son propre dossier sous `widgets/` et reste autonome, documenté et testable indépendamment.

## Architecture

Le dépôt ne conserve que les briques réellement partagées :

- `shared/ui/` — identité visuelle **Grist Studio** et composants structurels communs ;
- `shared/grist/` — primitives communes d’accès aux données et métadonnées Grist ;
- `shared/services/` — services réutilisables, notamment le calcul d’itinéraire IGN ;
- `widgets/` — widgets publiés et leurs tests dédiés ;
- `scripts/` — génération et préparation des données nécessaires aux widgets.

L’identité Grist Studio suit la grammaire commune **contexte → travail → validation**. Les widgets partagent les mêmes tokens, composants et règles de couleur, tandis que leur logique métier et leurs composants spécifiques restent locaux. Les mises en page responsive reposent sur les composants communs de `shared/ui/`.

## Assistant Structures

Chemin publié historique : `widgets/structure-picker/`.

L’Assistant Structures permet de rechercher, ajouter et compléter les structures de stage :

- recherche dans toute la table Grist ;
- recherche d’établissements via l’Annuaire des Entreprises ;
- enrichissement SIREN/SIRET et raison sociale ;
- géocodage IGN de l’adresse ;
- alimentation de Latitude/Longitude pour le widget carte ;
- recherche expérimentale de Téléphone, Courriel et Site web via cinq sources publiques : OpenStreetMap, Service-Public.fr (DILA), Wikidata, All The Places et Overture Places.

Les deux dernières sources utilisent des index statiques 44/85 préparés par GitHub Actions, découpés par code postal et publiés avec le site. La recherche de contacts reste explicitement **expérimentale** tant que la qualité du matching multi-source n’a pas été suffisamment validée sur les structures réelles. Aucune donnée n’est écrite sans validation explicite.

URL publiée :

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Tests dédiés : `npm run test:structure-picker`.

## Répartition des suivis de stage

Dossier : `widgets/internship-supervisor-assignment/`.

Le widget répartit les stages entre les enseignants à partir des quotas définis dans `Affectation` :

- classe pilotée par la source `Classe` et la sélection Grist ;
- périodes limitées à celles réellement définies pour la classe ;
- création explicite des stages manquants ;
- contrôle bloquant des incohérences ;
- conservation stricte des suivis déjà affectés ;
- optimisation de la diversité enseignant–élève ;
- prévisualisation avant écriture ;
- application sécurisée avec relecture des données avant modification.

La proximité géographique est affichée dans les réglages comme évolution prévue mais n’est pas encore implémentée.

URL publiée :

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

Tests dédiés : `npm run test:internship-supervisor-assignment`.

## Distance routière IGN

Dossier : `widgets/route-distance/`.

Le widget calcule, pour la ligne sélectionnée, la distance routière et la durée entre un point de départ configuré dans le code et la destination sélectionnée. Le calcul et l’écriture sont séparés : le résultat est vérifié avant enregistrement dans Grist.

L’appel à la Géoplateforme IGN est factorisé dans `shared/services/ign-route.js`. La configuration de l’origine par adresse constitue une évolution prévue.

URL publiée :

`https://djibian.github.io/grist-widgets/widgets/route-distance/`

Tests dédiés : `npm run test:route-distance`.

## Automatisation

Les workflows permanents sont limités à :

- `tests.yml` — CI de l’ensemble du dépôt ;
- `pages.yml` — publication de la production et des previews ;
- `pages-preview-trigger.yml` — reconstruction des previews lors des changements de branche ;
- `publish-contact-indexes.yml` — génération mensuelle ou manuelle des index ATP + Overture.

## Tests

La CI exécute l’ensemble des suites avec :

```bash
npm test
```
