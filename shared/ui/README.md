# UI partagée

Fondation visuelle commune des widgets du dépôt.

Principes : HTML, CSS et JavaScript natifs ; aucune dépendance d'exécution ni étape de build ; tokens et classes préfixés gw ; composants simples et composables ; accessibilité clavier et réduction des animations ; les composants spécifiques à un seul widget restent locaux.

Ordre de chargement recommandé : tokens.css, puis base.css, puis components.css. Un widget conserve ensuite sa feuille style.css locale pour sa mise en page et ses éléments métier.

Fichiers : tokens.css pour les variables de design ; base.css pour la base typographique ; components.css pour les composants génériques ; icons.js pour les icônes SVG ; demo pour la page de référence visuelle.

La bibliothèque reste volontairement petite. Un composant n'y entre que s'il est générique ou utilisé par plusieurs widgets.
