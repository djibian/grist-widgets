# grist-widgets

Collection de widgets personnalisés pour Grist.

La branche `main` est l’unique branche permanente, la référence du projet et la source publiée par GitHub Pages. Chaque widget vit dans son propre dossier sous `widgets/` et reste autonome, documenté et testable indépendamment.

Le dépôt partage uniquement les briques réellement communes :

- `shared/ui/` — identité visuelle Linear et composants génériques ;
- `shared/grist/` — petites primitives techniques communes à l’accès aux données Grist ;
- `shared/services/` — services réutilisables, notamment le calcul d’itinéraire IGN.

## Assistant Structures

Dossier historique : `widgets/structure-picker/`.

L’Assistant Structures permet de rechercher, ajouter et compléter les structures de stage :

- recherche dans toute la table Grist ;
- recherche d’établissements via l’Annuaire des Entreprises ;
- enrichissement SIREN/SIRET et raison sociale ;
- géocodage IGN de l’adresse ;
- alimentation de Latitude/Longitude pour le widget carte ;
- recherche expérimentale de Téléphone, Courriel et Site web via OpenStreetMap.

La recherche de contacts publics reste explicitement **expérimentale** et séparée du moteur stable d’enrichissement.

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

Le widget calcule, pour la ligne sélectionnée, la distance routière et éventuellement la durée entre un point de départ fixe et le domicile d’un élève. Le contexte de la ligne est capturé avant l’appel réseau afin d’éviter toute écriture sur une autre ligne en cas de changement de sélection pendant le calcul.

L’appel à la Géoplateforme IGN est factorisé dans `shared/services/ign-route.js`. L’origine est encore définie dans le code ; sa configuration par adresse constitue une évolution prévue.

URL publiée :

`https://djibian.github.io/grist-widgets/widgets/route-distance/`

Tests dédiés : `npm run test:route-distance`.

## Tests

La CI utilise un workflow unique et exécute l’ensemble des suites avec :

```bash
npm test
```
