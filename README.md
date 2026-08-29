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
