# Publication des index de contacts

Les index volumineux **All The Places** et **Overture Places** sont construits hors navigateur puis servis avec le site GitHub Pages. Ils ne sont jamais committés dans `main`.

## Périmètre publié

Le fichier `contact-indexes/publication-config.json` est le contrat de publication. En V1 :

- départements : `44`, `85` ;
- emprise Overture : `[-2.70, 46.20, -0.45, 47.95]` ;
- manifest runtime : `contact-indexes/indexed-departments.json`.

Changer le périmètre exige de modifier explicitement cette configuration puis de valider un nouveau snapshot. Le widget ne suppose jamais qu'un département est disponible s'il n'est pas annoncé par le manifest généré.

## Construction

`scripts/build-contact-index-snapshot.sh` construit un snapshot complet et cohérent :

1. résout le dernier run All The Places ;
2. télécharge l'archive officielle ATP ;
3. extrait uniquement les POI des départements configurés ;
4. exécute `generate-all-the-places-index.mjs` ;
5. résout la release Overture courante via STAC ;
6. télécharge les Places de l'emprise configurée avec le client officiel `overturemaps` ;
7. exécute `generate-overture-index.mjs` ;
8. vérifie le manifest, les départements, le schéma et les compteurs des quatre index.

Une erreur sur une source invalide la construction entière : il n'existe pas de publication partielle mélangeant des générations différentes.

## Publication GitHub Actions

Le workflow `Publish contact indexes` est lançable manuellement et planifié une fois par mois, le 21 à 04:23 UTC. Il exécute le builder, la suite de tests du dépôt puis publie un artefact GitHub Actions nommé `contact-indexes`, conservé 90 jours.

Les JSON générés ne sont donc pas ajoutés à l'historique Git. Le workflow Pages recherche le dernier run réussi de `Publish contact indexes`, télécharge son artefact puis remplace dans le site assemblé le répertoire `widgets/structure-picker/contact-indexes` par ce snapshot. Le même snapshot est superposé à la production et aux previews afin d'éviter des résultats différents selon l'URL testée.

Si aucun artefact valide n'est disponible, Pages conserve les fichiers de `main`. Le manifest de `main` annonce alors zéro département indexé : ATP et Overture sont simplement indisponibles et les sources directes OSM, DILA et Wikidata continuent de fonctionner.

Un nouveau snapshot réussi déclenche automatiquement un redéploiement Pages. Un workflow de génération en échec ne déclenche pas de publication de données incomplètes.

## Validation réelle du pipeline

Un probe complet a été exécuté le **14 septembre 2026** avec :

- All The Places : run `2026-09-05-13-32-25` ;
- Overture Places : release `2026-08-19.0` ;
- départements : `44`, `85`.

Résultat :

| Source | Département | Enregistrements | Taille JSON |
|---|---:|---:|---:|
| All The Places | 44 | 3 508 | 1,68 MiB |
| All The Places | 85 | 1 975 | 0,96 MiB |
| Overture Places | 44 | 40 814 | 38,15 MiB |
| Overture Places | 85 | 23 337 | 22,02 MiB |

Le snapshot complet représente environ **63 MiB non compressés**. L'artefact GitHub Actions correspondant occupait **10 949 745 octets**, soit environ **10,4 MiB**. La génération réelle et l'ensemble des tests du dépôt ont réussi.

## Séparation des responsabilités

Cette publication rend les fichiers disponibles sur Pages ; elle ne suffit pas à elle seule à interroger ATP et Overture dans le widget. Le raccordement runtime des index au résolveur multi-source est une étape distincte, avec ses propres règles de matching et de provenance.
