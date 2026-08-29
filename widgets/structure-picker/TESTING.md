# Test du widget Structure Picker

Le widget doit être testé sur une table Grist de structures.

## Configuration minimale

Mapper au minimum :

- `Nom` → colonne contenant le nom affiché ;
- `Adresse` → colonne contenant l'adresse ;
- `SIRET` → colonne contenant le SIRET.

Mappings optionnels recommandés si les colonnes existent :

- `NomCommercial` → enseigne / nom commercial ;
- `RaisonSociale` → raison sociale ;
- `SIREN` → SIREN ;
- `CodePostal` → code postal ;
- `Commune` → commune ;
- `APE` → code APE ;
- `Latitude` / `Longitude` → coordonnées ;
- `AdresseNormalisee` → adresse normalisée.

## Scénarios locaux

1. Rechercher une structure déjà présente par nom exact.
2. Rechercher la même structure avec une petite faute (`garag martn machecol`) : elle doit rester retrouvable.
3. Rechercher par commune ou adresse.
4. Rechercher par SIRET exact : la ligne correspondante doit être classée en premier.
5. Filtrer volontairement la vue Grist pour masquer une structure, puis la rechercher : elle doit quand même apparaître, car le widget lit la table complète.
6. Cliquer sur `Ouvrir` : le curseur Grist doit se placer sur la ligne correspondante.

## Scénarios externes

7. Rechercher `Netto Machecoul` : vérifier que les résultats proposés sont des établissements actifs du 44/85.
8. Rechercher `garage Machecoul` : vérifier la pertinence des résultats.
9. Vérifier qu'un établissement d'un autre département ne peut jamais apparaître, y compris lors d'une recherche directe par SIRET.
10. Vérifier qu'une structure externe dont le SIRET existe déjà dans Grist n'est pas reproposée.
11. Vérifier l'affichage distinct du nom commercial/enseigne et de la raison sociale lorsqu'ils diffèrent.
12. Cliquer sur `Ajouter` : la ligne créée doit contenir les champs disponibles et mappés, puis être automatiquement sélectionnée.
13. Vérifier que cette structure devient ensuite un résultat local et disparaît des résultats externes.

## Configuration et erreurs

14. Démapper `SIRET`, puis `Nom` ou `Adresse` : le widget doit se bloquer avec un message explicite et ne pas permettre d'ajout.
15. Taper moins de 3 caractères : la recherche locale peut fonctionner à partir de 2 caractères, mais aucun appel externe ne doit partir.
16. Enchaîner rapidement plusieurs recherches : seules les requêtes encore utiles doivent aboutir.
17. Répéter exactement une recherche déjà faite : le widget doit pouvoir servir le résultat depuis le cache de session.
18. Tester une indisponibilité réseau ou un HTTP 429 : la recherche locale doit rester utilisable et le message externe doit être explicite.
19. Tester `Créer manuellement` pour une structure que l'Annuaire ne retrouve pas.

## Concurrence

20. Avec deux navigateurs sur le même document, tenter d'ajouter presque simultanément le même SIRET. Le résultat attendu est une seule ligne conservée ; le navigateur ayant perdu la course doit sélectionner la ligne existante après réconciliation.

Cette protection est robuste côté widget mais ne remplace pas une règle ACL d'unicité SIRET si une garantie transactionnelle absolue est requise au niveau du document Grist.
