# Tests — Assistant Structures

## Mapping minimal

Mapper **Nom commercial**, **Adresse** et **SIREN / SIRET**. Mapper aussi **Latitude** et **Longitude** pour valider l'intégration avec le widget carte. Raison sociale est recommandée. Téléphone, Courriel et Site web sont facultatifs et ne sont pas encore enrichis automatiquement sur `develop`.

## Interface

1. Vérifier que le widget affiche uniquement les deux onglets **Rechercher / ajouter** et **Compléter la sélection**.
2. Avec une configuration valide, vérifier que la grande bannière de confirmation disparaît.
3. Vérifier qu'un petit compteur numérique apparaît en haut à droite et que son infobulle indique le nombre de structures de la table.
4. Vérifier que les intitulés de mapping restent simples, sans mentions techniques du type « recherche + écriture ».
5. Vérifier qu'APE/NAF n'apparaît plus dans le mapping, les résultats, le diagnostic ni les propositions.

## Recherche / ajout

6. Rechercher une structure existante par nom, adresse, commune et SIREN/SIRET.
7. Filtrer la vue Grist et vérifier que la recherche retrouve toujours les lignes masquées.
8. Rechercher une structure externe du 44/85 puis l'ajouter.
9. Vérifier qu'un SIRET déjà présent n'est pas reproposé.
10. Vérifier qu'aucun établissement hors 44/85 n'est proposé.
11. Vérifier qu'une colonne facultative calculée n'empêche pas l'ajout.

## Structure sélectionnée et enrichissement

12. Sélectionner une structure : le diagnostic doit suivre le curseur Grist.
13. Vérifier que des coordonnées vides restent affichées comme manquantes, jamais comme `0, 0`.
14. Cliquer sur **Analyser / compléter**.
15. Avec un SIRET existant, vérifier que l'Annuaire retrouve l'établissement correspondant.
16. Sans SIRET, vérifier que le nom commercial et le code postal/commune dérivés de l'adresse servent à la recherche.
17. S'il existe plusieurs établissements possibles, l'utilisateur doit choisir le bon.

## Géocodage et carte

18. Avec une adresse non normalisée, vérifier les propositions IGN.
19. L'adresse proposée ne doit pas écraser automatiquement l'adresse existante : la case reste décochée par défaut.
20. Latitude et Longitude sont proposées et cochées par défaut lorsqu'elles sont vides.
21. Appliquer l'adresse et les coordonnées puis vérifier leur utilisation par le widget carte.

## Sécurité

22. Une valeur existante différente ne doit jamais être remplacée sans validation explicite.
23. Un champ facultatif mappé vers une colonne formule doit être désactivé sans provoquer d'erreur d'écriture.
24. Un SIRET déjà affecté à une autre structure doit bloquer l'enrichissement et sélectionner la ligne existante.
