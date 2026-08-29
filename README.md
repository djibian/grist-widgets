# grist-widgets

Collection de widgets personnalisés pour Grist.

## Organisation

Chaque widget vit dans son propre dossier sous `widgets/` et doit rester autonome, documenté et testable indépendamment.

### Structure Picker

`widgets/structure-picker/`

Recherche une structure dans la table complète Grist puis complète la recherche avec les établissements officiels actifs des départements 44 et 85 via l'API Recherche d'Entreprises de la DINUM.

Prévisualisation HTTPS de la branche de développement :

`https://cdn.jsdelivr.net/gh/djibian/grist-widgets@develop/widgets/structure-picker/index.html`

Pour valider une version précise avant fusion, utiliser de préférence l'URL jsDelivr figée sur le SHA du commit `develop` à tester.

Les tests automatisés sont lancés avec :

```bash
npm test
```

Voir `widgets/structure-picker/README.md` pour la configuration Grist et `TESTING.md` pour les scénarios de validation.
