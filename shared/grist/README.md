# Utilitaires Grist partagés

Ce dossier contient uniquement des primitives techniques communes aux widgets.

- `records.js` reconstruit des objets ligne à partir du format colonnaire retourné par `grist.docApi.fetchTable`.
- `metadata.js` centralise la détection des colonnes calculées et leur caractère modifiable.

Les règles de mapping, de validation, d’écriture, de concurrence et les modèles métier restent volontairement dans chaque widget. Ce dossier ne doit pas devenir une couche d’abstraction générale autour de l’API Grist.
