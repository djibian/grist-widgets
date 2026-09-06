# grist-widgets

Collection de widgets personnalisés pour Grist.

Chaque widget vit dans son propre dossier sous `widgets/` et doit rester autonome, documenté et testable indépendamment.

## Assistant Structures

Dossier historique : `widgets/structure-picker/`

L'Assistant Structures permet de rechercher, ajouter et compléter les structures de stage :

- recherche dans toute la table Grist ;
- recherche d'établissements via l'Annuaire des Entreprises ;
- enrichissement SIREN/SIRET et raison sociale ;
- géocodage IGN de l'adresse ;
- alimentation de Latitude/Longitude pour le widget carte ;
- mappings facultatifs prêts pour Téléphone, Courriel et Site web.

Prévisualisation de `develop` via GitHub Pages :

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Tests : `npm test`.

## Répartition des suivis de stage

Dossier : `widgets/internship-supervisor-assignment/`

Version stable actuelle : **V1.1.4**.

Le widget répartit les stages entre les enseignants à partir des quotas définis dans `Affectation` :

- classe pilotée par la source `Classe` et la sélection Grist ;
- périodes limitées à celles réellement définies pour la classe ;
- création explicite des stages manquants ;
- contrôle bloquant des incohérences ;
- conservation stricte des suivis déjà affectés ;
- optimisation de la diversité enseignant–élève ;
- prévisualisation avant écriture ;
- application sécurisée avec relecture des données avant modification.

URL du widget :

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

Tests dédiés : `npm run test:internship-supervisor-assignment`.
