# Tests — Assistant Structures

## Mapping minimal

Mapper Nom commercial, Adresse et SIREN / SIRET. Mapper aussi **Latitude** et **Longitude** pour valider l'intégration avec le widget carte. Raison sociale et APE sont recommandés.

## Recherche / ajout

1. Rechercher une structure existante par nom, adresse, commune et SIREN/SIRET.
2. Filtrer la vue Grist et vérifier que la recherche retrouve toujours les lignes masquées.
3. Rechercher une structure externe du 44/85 puis l'ajouter.
4. Vérifier qu'un SIRET déjà présent n'est pas reproposé.
5. Vérifier qu'aucun établissement hors 44/85 n'est proposé.
6. Vérifier qu'une colonne facultative calculée n'empêche pas l'ajout.

## Structure sélectionnée et enrichissement

7. Sélectionner une structure : le diagnostic doit suivre le curseur Grist.
8. Vérifier que des coordonnées vides restent affichées comme manquantes, jamais comme `0, 0`.
9. Cliquer sur **Analyser / compléter**.
10. Avec un SIRET existant, vérifier que l'Annuaire retrouve l'établissement correspondant.
11. Sans SIRET, vérifier que le nom commercial et le code postal/commune dérivés de l'adresse servent à la recherche.
12. S'il existe plusieurs établissements possibles, l'utilisateur doit choisir le bon.

## Géocodage et carte

13. Avec une adresse non normalisée, vérifier les propositions IGN.
14. L'adresse proposée ne doit pas écraser automatiquement l'adresse existante : la case reste décochée par défaut.
15. Latitude et Longitude sont proposées et cochées par défaut lorsqu'elles sont vides.
16. Appliquer l'adresse et les coordonnées puis vérifier leur utilisation par le widget carte.

## Sécurité

17. Une valeur existante différente ne doit jamais être remplacée sans validation explicite.
18. Un champ facultatif mappé vers une colonne formule doit être désactivé sans provoquer d'erreur d'écriture.
19. Un SIRET déjà affecté à une autre structure doit bloquer l'enrichissement et sélectionner la ligne existante.
