# Publication des index de contacts

Les index volumineux **All The Places** et **Overture Places** sont construits hors navigateur puis servis avec le site GitHub Pages. Ils ne sont jamais committés dans `main`.

## Périmètre publié

Le fichier `contact-indexes/publication-config.json` est le contrat de publication. En V1 :

- départements : `44`, `85` ;
- emprise Overture : `[-2.70, 46.20, -0.45, 47.95]` ;
- manifest runtime : `contact-indexes/indexed-departments.json`.

Changer le périmètre exige de modifier explicitement cette configuration puis de valider un nouveau snapshot. Le widget ne suppose jamais qu'un département est disponible s'il n'est pas annoncé par le manifest généré.

## Construction et format runtime

`scripts/build-contact-index-snapshot.sh` construit un snapshot complet et cohérent :

1. résout et télécharge le dernier run All The Places ;
2. extrait uniquement les POI des départements configurés et produit les index départementaux intermédiaires ;
3. résout la release Overture courante et télécharge les Places de l'emprise configurée ;
4. produit les index départementaux Overture intermédiaires ;
5. `scripts/build-contact-runtime-shards.mjs` compacte ensuite chaque source et la découpe **par code postal** ;
6. le manifest final annonce `shardBy: "postcode"` et un `pathTemplate` de type `overture/{department}/{postcode}.json` ;
7. le builder vérifie tous les shards, leurs métadonnées et leurs compteurs avant publication.

Une erreur sur une source invalide la construction entière : il n'existe pas de publication partielle mélangeant des générations différentes.

Le découpage par code postal est nécessaire pour le navigateur : le widget ne charge jamais les 20 à 40 MiB d'un département Overture. Il déduit le code postal depuis l'adresse de la structure puis télécharge uniquement le shard correspondant. Un shard absent (`404`) équivaut à une source sans résultat et ne bloque pas OSM, DILA ou Wikidata.

Overture est compacté avant publication : les contacts alternatifs sont conservés, ainsi que le score `confidence`, la liste compacte des jeux de données amont et un indicateur explicite de lignée All The Places. Les objets détaillés `sources[]` ne sont pas nécessaires au runtime et ne sont pas publiés dans les shards.

## Publication GitHub Actions

Le workflow `Publish contact indexes` est lançable manuellement et planifié une fois par mois, le 21 à 04:23 UTC. Il exécute le builder, la suite de tests du dépôt puis publie un artefact GitHub Actions nommé `contact-indexes`, conservé 90 jours.

Les JSON générés ne sont donc pas ajoutés à l'historique Git. Le workflow Pages recherche le dernier run réussi de `Publish contact indexes`, télécharge son artefact puis remplace dans le site assemblé le répertoire `widgets/structure-picker/contact-indexes` par ce snapshot. Le même snapshot est superposé à la production et aux previews afin d'éviter des résultats différents selon l'URL testée.

Si aucun artefact valide n'est disponible, Pages conserve les fichiers de `main`. Le manifest de `main` annonce alors zéro département indexé : ATP et Overture n'apportent simplement aucun résultat et les sources directes OSM, DILA et Wikidata continuent de fonctionner.

Un nouveau snapshot réussi déclenche automatiquement un redéploiement Pages. Un workflow de génération en échec ne déclenche pas de publication de données incomplètes.

## Validation réelle du pipeline sharded

Le pipeline runtime complet a été exécuté le **14 septembre 2026** avec :

- All The Places : run `2026-09-05-13-32-25` ;
- Overture Places : release `2026-08-19.0` ;
- départements : `44`, `85`.

Résultat :

| Source | Département | Enregistrements | Shards postaux | Taille JSON totale |
|---|---:|---:|---:|---:|
| All The Places | 44 | 3 508 | 139 | 1,71 MiB |
| All The Places | 85 | 1 975 | 86 | 0,98 MiB |
| Overture Places | 44 | 40 814 | 192 | 21,11 MiB |
| Overture Places | 85 | 23 337 | 102 | 12,28 MiB |

Aucun enregistrement indexable n'est perdu par le sharding. Le snapshot publié représente environ **38 MiB non compressés** répartis dans 521 fichiers ; l'artefact GitHub Actions du probe occupait **8 019 740 octets**, soit environ **7,65 MiB**.

La charge réellement supportée par le navigateur est beaucoup plus faible : sur le snapshot mesuré, le code postal `44140` représente environ **14 KiB ATP + 225 KiB Overture**. Le plus gros shard Overture observé est `44000`, autour de **2,7 MiB** ; 95 % des shards Overture sont inférieurs à environ **0,5 MiB**.

La construction réelle et la totalité de la suite de tests ont réussi. Le workflow de probe utilisé pour cette validation n'est pas conservé dans le dépôt.

## Raccordement au résolveur

ATP et Overture utilisent le même orchestrateur et le même modèle canonique que les sources directes. Le runtime :

- exige un code postal exploitable dans l'adresse avant d'activer une source indexée ;
- ne charge qu'un shard postal par source ;
- présélectionne localement les candidats par SIRET, adresse, nom et proximité ;
- limite chaque source indexée aux 16 meilleurs candidats avant la déduplication et le classement communs ;
- conserve les contacts alternatifs Overture sans inventer d'association entre un téléphone, un courriel et un site alternatifs ;
- marque une lignée ATP dans Overture comme provenance commune, jamais comme corroboration indépendante ;
- n'autorise aucune écriture automatique supplémentaire : les règles de validation et de confirmation Grist restent inchangées.
