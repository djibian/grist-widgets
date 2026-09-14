# Overture Places — mesure de couverture 44 / 85

Mesure réalisée le 14 septembre 2026 sur la release Overture `2026-08-19.0` (schéma `v1.18.0`) avec le client officiel `overturemaps 1.0.2`.

## Méthode

Le client officiel Overture utilise son catalogue STAC pour cibler automatiquement la release courante. Un export `place` au format GeoJSONSeq a été téléchargé sur une boîte englobant volontairement la Loire-Atlantique et la Vendée (`-2.70,46.20,-0.45,47.95`), puis filtré par le générateur `scripts/generate-overture-index.mjs` à partir des codes postaux `44` et `85`.

Le générateur ne conserve que les établissements non marqués `permanently_closed`, appartenant aux départements demandés et fournissant au moins un téléphone, un courriel ou un site web. Aucun index volumineux n'est commité à ce stade.

## Résultats

L'export géographique contenait 104 780 places. Après filtrage départemental et par présence d'au moins un contact, 64 151 enregistrements uniques restent exploitables.

| Département | Indexés | Téléphone | Courriel | Site web | Confiance ≥ 0,80 | Lignée ATP |
|---|---:|---:|---:|---:|---:|---:|
| 44 | 40 814 | 37 843 (92,7 %) | 25 358 (62,1 %) | 34 427 (84,4 %) | 17 103 (41,9 %) | 1 061 (2,6 %) |
| 85 | 23 337 | 21 980 (94,2 %) | 15 308 (65,6 %) | 18 750 (80,3 %) | 9 775 (41,9 %) | 564 (2,4 %) |
| **Total** | **64 151** | **59 823 (93,2 %)** | **40 666 (63,4 %)** | **53 177 (82,9 %)** | **26 878 (41,9 %)** | **1 625 (2,5 %)** |

13 538 fiches (21,1 %) ont une confiance Overture ≥ 0,95. Toutes les fiches indexées ont une adresse et des coordonnées, car ces propriétés sont présentes sur les places retenues dans cette extraction.

Les principaux jeux de données amont présents dans la provenance sont :

- `meta` : 53 376 occurrences ;
- `Foursquare` : 8 821 ;
- `AllThePlaces` : 1 625 ;
- `PinMeTo` : 288 ;
- `DAC` : 41.

Chaque fiche porte aussi une provenance `Overture`, correspondant au produit conflé.

## Comparaison avec All The Places

La mesure ATP précédente avait produit 5 483 fiches avec contacts sur les mêmes départements. Overture fournit donc un réservoir de candidats beaucoup plus large et des taux de présence des contacts supérieurs, notamment pour le téléphone et le courriel.

Il ne faut toutefois pas interpréter automatiquement une concordance ATP + Overture comme deux preuves indépendantes. Overture Places intègre notamment All The Places parmi ses fournisseurs. Sur cette extraction, 1 625 fiches (2,5 %) possèdent explicitement une lignée `AllThePlaces`.

La provenance `sources[]` de la release mesurée permet d'identifier les jeux de données amont mais ne permet pas, dans notre extraction, d'attribuer de manière fiable chaque téléphone/courriel/site à un fournisseur précis. Par conséquent :

- si une fiche Overture porte une lignée `AllThePlaces`, une concordance avec ATP ne doit **pas** renforcer à elle seule la confiance comme corroboration indépendante ;
- si aucune lignée ATP n'est présente, une concordance ATP + Overture peut être considérée comme issue de chaînes de provenance distinctes, sous réserve des autres critères de rapprochement ;
- le score `confidence` Overture reste un signal d'existence, pas une probabilité que les coordonnées de contact soient exactes.

## Décision

**Overture Places est retenu comme source complémentaire majeure.**

Son rôle prévu est :

1. proposer des candidats de contact à partir du nom, de l'adresse et de la proximité géographique ;
2. fournir son score d'existence comme signal additionnel de classement ;
3. conserver le GERS ID et la provenance amont ;
4. ne jamais être considéré comme une source d'identité équivalente à un SIRET ;
5. éviter tout double comptage de preuve lorsque la lignée Overture contient All The Places.

Aucune activation dans l'interface ni publication des index 44/85 n'est effectuée à cette étape. L'automatisation de génération/publication reste réservée à l'étape 12.
