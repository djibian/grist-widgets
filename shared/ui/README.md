# UI partagée — Grist Studio

Fondation visuelle commune des widgets du dépôt.

## Identité

**Grist Studio** est l'identité visuelle de référence du dépôt. Elle privilégie une interface de travail calme, compacte et explicite : canvas légèrement chaud, surfaces blanches, texte sombre, accent jade pour l'action principale, et accents fonctionnels discrets pour l'organisation et la géographie.

La grammaire d'interface commune est : **contexte → travail → validation**.

Principes :

- le contexte Grist concerné par l'action reste visible ;
- une seule action principale domine chaque zone ;
- les conséquences d'une écriture sont montrées avant validation lorsqu'elles sont significatives ;
- les actions globales d'un widget sont placées dans l'en-tête, à droite ;
- sur ordinateur, les actions importantes comme `Actualiser` et `Paramétrage` sont libellées ; sur petite largeur, elles peuvent devenir icon-only ;
- les couleurs sémantiques signalent un état, elles ne servent pas de décoration ;
- les composants spécifiques à un seul widget restent locaux.

## Architecture

HTML, CSS et JavaScript natifs ; aucune dépendance d'exécution ni étape de build. Les tokens et classes partagés sont préfixés `gw`.

Ordre de chargement recommandé : `tokens.css`, puis `base.css`, puis `components.css`, puis `structure.css`. Un widget conserve ensuite sa feuille `style.css` locale pour ses éléments métier ; une feuille locale complémentaire peut préciser une composition spécifique sans redéfinir le socle.

`structure.css` porte les grands motifs de composition Grist Studio :

- `gw-widget-frame` et `gw-widget-header` — cadre et identité du widget ;
- `gw-context-strip` / `gw-context-item` — contexte Grist permanent ;
- `gw-work-section` ou `gw-work-grid` — espace de travail ;
- `gw-decision-panel` — vérification ou décision avant action ;
- `gw-step-heading` — étapes explicites du flux ;
- `gw-action-dock` / `gw-validation-bar` — action dominante et validation.

Ces classes doivent porter la structure commune. Le CSS local ne doit conserver que les éléments réellement propres au métier du widget.

## Fichiers

- `tokens.css` — couleurs, typographie, espacements, rayons, ombres et accents fonctionnels ;
- `base.css` — canvas, base typographique, focus et réduction des animations ;
- `components.css` — boutons, actions d'en-tête, cartes, statuts, badges, formulaires, métriques et tables ;
- `structure.css` — composition `contexte → travail → validation` ;
- `icons.js` — définitions SVG partagées ;
- `demo/` — démonstrations et références visuelles.

La référence Linear conservée sous `demo/inspirations/linear-final.html` documente l'étape précédente de convergence. Elle n'est plus la spécification visuelle active.
