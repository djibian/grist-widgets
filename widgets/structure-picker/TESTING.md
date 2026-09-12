# Tests — Assistant Structures

## Mapping minimal

Mapper **Nom usuel**, **Adresse** et **SIREN / SIRET**. Mapper aussi **Latitude** et **Longitude** pour valider l’intégration avec le widget carte. **Raison sociale** est recommandée. Téléphone, Courriel et Site web sont facultatifs et servent uniquement à l’expérience **Contacts publics**.

## Interface

1. Vérifier que le widget affiche uniquement les deux onglets **Rechercher / ajouter** et **Compléter la sélection**.
2. Avec une configuration valide, vérifier que la grande bannière de confirmation disparaît.
3. Vérifier qu’un petit compteur numérique apparaît en haut à droite et que son infobulle indique le nombre de structures de la table.
4. Vérifier que les intitulés de mapping restent simples, sans mentions techniques du type « recherche + écriture ».
5. Vérifier qu’APE/NAF n’apparaît plus dans le mapping, les résultats, le diagnostic ni les propositions.
6. Vérifier que la terminologie visible utilise **Nom usuel** et non **Nom commercial**.

## Recherche / ajout

7. Rechercher une structure existante par nom, adresse, commune et SIREN/SIRET.
8. Filtrer la vue Grist et vérifier que la recherche retrouve toujours les lignes masquées.
9. Rechercher une structure externe du 44/85 puis l’ajouter.
10. Vérifier qu’un SIRET déjà présent n’est pas reproposé.
11. Vérifier qu’aucun établissement hors 44/85 n’est proposé.
12. Vérifier qu’une colonne facultative calculée n’empêche pas l’ajout.
13. Utiliser la création manuelle et vérifier qu’une nouvelle ligne Grist est préparée pour la saisie dans la vue.

## Structure sélectionnée et enrichissement

14. Sélectionner une structure : le diagnostic doit suivre le curseur Grist.
15. Vérifier que des coordonnées vides restent affichées comme manquantes, jamais comme `0, 0`.
16. Cliquer sur **Analyser / compléter**.
17. Avec un SIRET existant, vérifier que l’Annuaire retrouve l’établissement correspondant.
18. Sans SIRET, vérifier que le nom usuel et le code postal/commune dérivés de l’adresse servent à la recherche.
19. S’il existe plusieurs établissements possibles, l’utilisateur doit choisir le bon.

## Géocodage et carte

20. Avec une adresse non normalisée, vérifier les propositions IGN.
21. L’adresse proposée ne doit pas écraser automatiquement l’adresse existante : la case reste décochée par défaut.
22. Latitude et Longitude sont proposées et cochées par défaut lorsqu’elles sont vides.
23. Appliquer l’adresse et les coordonnées puis vérifier leur utilisation par le widget carte.

## Sécurité

24. Une valeur existante différente ne doit jamais être remplacée sans validation explicite.
25. Un champ facultatif mappé vers une colonne formule doit être désactivé sans provoquer d’erreur d’écriture.
26. Un SIRET déjà affecté à une autre structure doit bloquer l’enrichissement et sélectionner la ligne existante.

## Contacts publics — expérimental

27. Avec un SIRET présent dans OpenStreetMap, vérifier que la correspondance exacte est prioritaire et que seuls les champs vides et modifiables sont présélectionnés.
28. Sans correspondance SIRET mais avec nom et coordonnées, vérifier que les propositions par proximité restent explicitement présentées comme probables et qu’aucun champ n’est présélectionné.
29. Vérifier qu’un Téléphone, Courriel ou Site web non mappé ou non modifiable est désactivé.
30. Vérifier qu’aucun contact existant n’est remplacé sans case cochée.
31. Vérifier qu’une absence de résultat ou une indisponibilité d’Overpass n’empêche pas la recherche Annuaire ni le géocodage IGN.
32. Sur un échantillon de structures réelles du 44/85, relever la couverture et les éventuels faux positifs afin de décider du maintien, de la promotion ou du retrait de l’expérience.
