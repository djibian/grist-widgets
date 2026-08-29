# Test du widget Structure Picker

URL de test GitHub Pages :

`https://djibian.github.io/grist-widgets/widgets/structure-picker/`

Le widget doit être relié à la table Grist des structures.

## Mappings obligatoires

Mapper vers des **colonnes de données modifiables** :

- `Nom commercial — recherche + écriture` → colonne du nom commercial / enseigne ;
- `Adresse — recherche + écriture` → colonne contenant l'adresse saisie ;
- `SIREN / SIRET — recherche + écriture` → unique colonne d'immatriculation.

## Mappings facultatifs

- `Adresse normalisée — recherche uniquement` → sortie du géocodeur. Cette colonne peut être calculée : le widget n'y écrit jamais.
- `Raison sociale — recherche + écriture`.
- `Code APE / NAF — écriture uniquement`.
- `Latitude — écriture uniquement`.
- `Longitude — écriture uniquement`.

Il n'existe plus de mapping `Code postal`, `Commune`, `Nom`, `SIREN` ou `SIRET` séparé.

Le code postal et la commune sont déduits automatiquement de l'adresse normalisée pour la recherche locale.

## Scénarios locaux

1. Rechercher une structure déjà présente par nom commercial exact.
2. Rechercher la même structure avec une petite faute (`garag martn machecol`) : elle doit rester retrouvable.
3. Rechercher par raison sociale.
4. Rechercher par commune ou code postal présents uniquement dans l'adresse normalisée : la structure doit être trouvée.
5. Rechercher par SIRET exact (14 chiffres) : la ligne correspondante doit être classée en premier.
6. Si une ancienne ligne contient seulement un SIREN (9 chiffres), rechercher ce SIREN : la ligne doit être trouvée.
7. Filtrer volontairement la vue Grist pour masquer une structure, puis la rechercher : elle doit quand même apparaître, car le widget lit la table complète.
8. Cliquer sur `Ouvrir` : le curseur Grist doit se placer sur la ligne correspondante.

## Scénarios externes

9. Rechercher `Netto Machecoul` : vérifier que les résultats proposés sont des établissements actifs du 44/85.
10. Rechercher `garage Machecoul` : vérifier la pertinence des résultats.
11. Vérifier qu'un établissement d'un autre département ne peut jamais apparaître, y compris lors d'une recherche directe par SIRET.
12. Vérifier qu'une structure externe dont le SIRET existe déjà dans Grist n'est pas reproposée.
13. Vérifier qu'une ligne locale contenant seulement le SIREN empêche également de reproposer un établissement portant ce SIREN.
14. Vérifier l'affichage distinct du nom commercial et de la raison sociale lorsqu'ils diffèrent.
15. Cliquer sur `Ajouter` : le widget doit écrire le nom commercial, l'adresse et le SIRET dans les trois colonnes obligatoires, compléter les destinations facultatives modifiables, puis sélectionner la nouvelle ligne.
16. Vérifier que le code postal et la commune ne font l'objet d'aucune tentative d'écriture.
17. Vérifier que la nouvelle structure devient ensuite un résultat local et disparaît des résultats externes.

## Colonnes calculées

18. Mapper `APE`, `Latitude` ou `Longitude` vers une colonne formule : l'ajout doit continuer à fonctionner et le champ calculé doit être ignoré avec un avertissement.
19. Mapper `Adresse normalisée` vers une colonne formule : le widget doit continuer à fonctionner normalement puisqu'elle est en lecture seule pour lui.
20. Mapper volontairement `Nom commercial`, `Adresse` ou `SIREN / SIRET` vers une colonne formule : le widget doit se bloquer avant tout ajout avec un message explicite. Aucune exception `Can't save value to formula column` ne doit apparaître.

## Configuration et erreurs

21. Démapper l'un des trois champs obligatoires : le widget doit se bloquer avec un message explicite.
22. Taper moins de 3 caractères : la recherche locale peut fonctionner à partir de 2 caractères, mais aucun appel externe ne doit partir.
23. Enchaîner rapidement plusieurs recherches : seules les requêtes encore utiles doivent aboutir.
24. Répéter exactement une recherche déjà faite : le widget doit pouvoir servir le résultat depuis le cache de session.
25. Tester une indisponibilité réseau ou un HTTP 429 : la recherche locale doit rester utilisable et le message externe doit être explicite.
26. Tester `Créer manuellement` pour une structure que l'Annuaire ne retrouve pas.

## Concurrence

27. Avec deux navigateurs sur le même document, tenter d'ajouter presque simultanément le même SIRET. Le résultat attendu est une seule ligne conservée ; le navigateur ayant perdu la course doit sélectionner la ligne existante après réconciliation.

Cette protection est robuste côté widget mais ne remplace pas une règle d'unicité au niveau du document si une garantie transactionnelle absolue est requise.
