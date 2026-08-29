# Tests — Assistant Structures

## Mapping minimal

Mapper Nom commercial, Adresse et SIREN / SIRET. Mapper aussi **Latitude** et **Longitude** pour valider l'intégration avec le widget carte. Raison sociale et APE sont recommandés.

## Interface à deux onglets

1. Vérifier que **Rechercher / ajouter** est l'onglet ouvert par défaut.
2. Vérifier que le champ de recherche est immédiatement suivi de ses résultats Grist puis Annuaire, sans panneau d'enrichissement intercalé.
3. Vérifier que **Structure introuvable ? Créer manuellement** apparaît en dernier recours dans cet onglet.
4. Passer à **Compléter la sélection** puis revenir à la recherche : la saisie et les résultats doivent rester en place.
5. Sélectionner différentes structures dans Grist : le badge de l'onglet **Compléter la sélection** doit refléter le nombre d'informations manquantes.
6. Vérifier qu'une sélection Grist ne force jamais automatiquement le changement d'onglet.

## Recherche / ajout

7. Rechercher une structure existante par nom, adresse, commune et SIREN/SIRET.
8. Filtrer la vue Grist et vérifier que la recherche retrouve toujours les lignes masquées.
9. Rechercher une structure externe du 44/85 puis l'ajouter.
10. Vérifier qu'un SIRET déjà présent n'est pas reproposé.
11. Vérifier qu'aucun établissement hors 44/85 n'est proposé.
12. Vérifier qu'une colonne facultative calculée n'empêche pas l'ajout.

## Structure sélectionnée et enrichissement

13. Sélectionner une structure : le diagnostic doit suivre le curseur Grist.
14. Vérifier que des coordonnées vides restent affichées comme manquantes, jamais comme `0, 0`.
15. Cliquer sur **Analyser / compléter**.
16. Avec un SIRET existant, vérifier que l'Annuaire retrouve l'établissement correspondant.
17. Sans SIRET, vérifier que le nom commercial et le code postal/commune dérivés de l'adresse servent à la recherche.
18. S'il existe plusieurs établissements possibles, l'utilisateur doit choisir le bon.

## Géocodage et carte

19. Avec une adresse non normalisée, vérifier les propositions IGN.
20. L'adresse proposée ne doit pas écraser automatiquement l'adresse existante : la case reste décochée par défaut.
21. Latitude et Longitude sont proposées et cochées par défaut lorsqu'elles sont vides.
22. Appliquer l'adresse et les coordonnées puis vérifier leur utilisation par le widget carte.

## Sécurité

23. Une valeur existante différente ne doit jamais être remplacée sans validation explicite.
24. Un champ facultatif mappé vers une colonne formule doit être désactivé sans provoquer d'erreur d'écriture.
25. Un SIRET déjà affecté à une autre structure doit bloquer l'enrichissement et sélectionner la ligne existante.
