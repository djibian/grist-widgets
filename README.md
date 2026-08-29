# grist-widgets

Collection de widgets personnalisés pour Grist.

## Organisation

Chaque widget vit dans son propre dossier sous `widgets/` et doit rester autonome, documenté et testable indépendamment.

### Structure Picker

`widgets/structure-picker/`

Recherche une structure dans la table complète Grist puis complète la recherche avec les établissements officiels actifs des départements 44 et 85 via l'API Recherche d'Entreprises de la DINUM.

Prévisualisation Grist de la branche de développement publiée par GitHub Pages :

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Pendant le développement, GitHub Pages doit publier la branche `develop`. Après validation et fusion, la stratégie de publication pourra être stabilisée sur `main`.

Les tests automatisés sont lancés avec :

```bash
npm test
```

Voir `widgets/structure-picker/README.md` pour la configuration Grist et `TESTING.md` pour les scénarios de validation.
