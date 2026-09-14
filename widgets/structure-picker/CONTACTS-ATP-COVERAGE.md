# Mesure de couverture — All The Places

Mesure réalisée le 14 septembre 2026 sur le run All The Places `2026-09-05-13-32-25`, terminé le 9 septembre 2026 à 08:16:19 UTC.

La mesure utilise l'archive officielle du run ATP, filtre les départements 44 et 85, puis fait passer les données retenues par le générateur réel `scripts/generate-all-the-places-index.mjs`.

## Résultats

| Département | POI ATP | Avec au moins un contact | Indexés uniques | Téléphone | Courriel | Site web | SIRET |
|---|---:|---:|---:|---:|---:|---:|---:|
| 44 | 5 553 | 3 508 (63,2 %) | 3 508 | 2 914 (83,1 %) | 862 (24,6 %) | 2 732 (77,9 %) | 0 |
| 85 | 3 262 | 1 975 (60,6 %) | 1 975 | 1 761 (89,2 %) | 684 (34,6 %) | 1 466 (74,2 %) | 0 |
| **Total** | **8 815** | **5 483** | **5 483** | **4 675 (85,3 %)** | **1 546 (28,2 %)** | **4 198 (76,6 %)** | **0** |

Les enregistrements indexés disposent presque toujours de coordonnées : 97,3 % dans le 44 et 98,0 % dans le 85. Tous les enregistrements retenus possèdent une adresse exploitable dans l'index.

Le corpus est réparti sur 250 spiders distincts dans le 44 et 184 dans le 85. Les contributeurs les plus importants sont notamment Renault, AXA, les réseaux bancaires, E.Leclerc, Carrefour, Peugeot et TotalEnergies : ATP est donc particulièrement fort sur les enseignes et réseaux structurés.

## Portée de la mesure

L'archive mesurée pèse 2 773 305 780 octets. Le scan a parcouru 5 074 fichiers GeoJSON et 40 320 302 features. 479 sorties GeoJSON n'ont pas pu être parsées ; les erreurs échantillonnées correspondent à des fichiers sans contenu JSON exploitable. Elles sont ignorées sans bloquer la mesure.

Cette mesure évalue la **densité de contacts disponibles dans ATP**, pas encore le taux de correspondance avec les structures effectivement présentes dans un document Grist.

## Conclusion

**All The Places est retenu comme source complémentaire.**

Ses points forts sont nets :

- très bonne présence du téléphone parmi les fiches retenues ;
- bonne présence du site web ;
- coordonnées géographiques presque systématiques ;
- adresses exploitables ;
- couverture de plusieurs centaines de réseaux différents dans les deux départements.

Ses limites sont tout aussi importantes :

- le courriel est beaucoup moins fréquent ;
- aucune fiche avec contacts du corpus mesuré ne fournit de SIRET ;
- la couverture est orientée vers les enseignes et réseaux disposant d'un localisateur public ;
- ATP ne doit donc pas être utilisé seul pour identifier une structure.

Le rapprochement ATP devra principalement s'appuyer sur **adresse + coordonnées + nom**, avec un niveau de confiance généralement `Probable`. La provenance ATP doit rester visible. Les autres sources indexées, notamment Overture puis FSQ, restent nécessaires pour élargir la couverture et permettre la corroboration multi-source.

## Reproductibilité

La mesure est exécutée par `.github/workflows/measure-atp-coverage.yml` et `scripts/measure-all-the-places-coverage.py`.

Run GitHub Actions de référence : `34836687724`.
