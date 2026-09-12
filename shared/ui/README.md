# UI partagée — Grist Studio

Fondation visuelle commune des widgets du dépôt.

## Identité

**Grist Studio** est l’identité visuelle de référence. Elle privilégie une interface de travail calme, compacte et explicite : canvas légèrement chaud, surfaces blanches, texte sombre, bleu pour l’identité et la progression, jade pour l’action et la validation.

La grammaire commune est : **contexte → travail → validation**.

### Contrat couleur

- **bleu workflow** — identité, navigation, étapes, sources et informations structurantes ;
- **jade** — actions principales, sélection, validation et succès ;
- **ambre** — attention ou donnée manquante ;
- **rouge** — erreur bloquante ;
- **violet** — expérimental.

### Principes

- le contexte Grist concerné par l’action reste visible ;
- une seule action principale domine chaque zone ;
- les conséquences d’une écriture sont montrées avant validation lorsqu’elles sont significatives ;
- les actions globales d’un widget sont placées dans l’en-tête, à droite ;
- sur ordinateur, les actions importantes comme `Actualiser` et `Paramétrage` sont libellées ; sur petite largeur, elles peuvent devenir icon-only ;
- les couleurs sémantiques signalent un état, elles ne servent pas de décoration ;
- les composants spécifiques à un seul widget restent locaux.

## Architecture

HTML, CSS et JavaScript natifs ; aucune dépendance d’exécution ni étape de build. Les tokens et classes partagés sont préfixés `gw`.

Ordre de chargement recommandé :

1. `tokens.css`
2. `base.css`
3. `components.css`
4. `structure.css`
5. la feuille `style.css` propre au widget

`structure.css` porte les grands motifs de composition :

- `gw-widget-frame` et `gw-widget-header` — cadre et identité du widget ;
- `gw-context-strip` / `gw-context-item` — contexte Grist permanent ;
- `gw-work-section` ou `gw-work-grid` — espace de travail ;
- `gw-decision-panel` — vérification ou décision avant action ;
- `gw-step-heading` — étapes explicites du flux ;
- `gw-action-dock` / `gw-validation-bar` — action dominante et validation.

Le CSS local ne doit conserver que les éléments réellement propres au métier du widget.

## Fichiers actifs

- `tokens.css` — couleurs, typographie, espacements, rayons, ombres et rôles sémantiques ;
- `base.css` — canvas, base typographique, focus et réduction des animations ;
- `components.css` — boutons, actions d’en-tête, statuts, badges, champs et tables réellement partagés ;
- `structure.css` — composition `contexte → travail → validation`.
