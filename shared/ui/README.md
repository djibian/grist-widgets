# UI partagée

Fondation visuelle commune des widgets du dépôt.

Principes : HTML, CSS et JavaScript natifs ; aucune dépendance d’exécution ni étape de build ; tokens et classes préfixés `gw` ; composants simples et composables ; accessibilité clavier et réduction des animations ; les composants spécifiques à un seul widget restent locaux.

Ordre de chargement recommandé : `tokens.css`, puis `base.css`, puis `components.css`. Un widget conserve ensuite sa feuille `style.css` locale pour sa mise en page et ses éléments métier.

## Fichiers

- `tokens.css` — variables de design ;
- `base.css` — base typographique et styles globaux ;
- `components.css` — composants génériques partagés ;
- `icons.js` — définitions SVG de référence, notamment les icônes Actualiser et Paramètres validées ;
- `demo/` — démonstration des composants partagés ;
- `demo/inspirations/linear-final.html` — référence visuelle définitive du système Linear validé.

La référence visuelle finale est publiée ici :

`https://djibian.github.io/grist-widgets/shared/ui/demo/inspirations/linear-final.html`

Les anciennes planches de comparaison et cycles de convergence ont été retirés de l’arbre courant après validation. Leur historique reste disponible dans Git.

La bibliothèque reste volontairement petite. Un composant n’y entre que s’il est générique ou réellement utilisé par plusieurs widgets.
