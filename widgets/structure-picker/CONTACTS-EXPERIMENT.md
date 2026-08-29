# Expérience — contacts publics via OpenStreetMap

Cette branche teste un enrichissement facultatif des structures avec **Téléphone**, **Courriel** et **Site web** sans modifier le moteur stable de l'Assistant Structures.

## Stratégie

1. Si la ligne Grist possède un SIRET, interroger OpenStreetMap par `ref:FR:SIRET`.
2. Si aucun contact exploitable n'est trouvé, et si un nom + des coordonnées sont disponibles, chercher dans un rayon de 300 m les objets OSM nommés qui publient au moins un contact.
3. Classer les résultats de secours par similitude du nom puis distance.

Endpoint Overpass :

`https://overpass-api.de/api/interpreter`

Les requêtes sont envoyées en POST et restent bornées à une structure ou à un rayon local de 300 m.

## Confiance

### Correspondance SIRET

Le même SIRET est présent dans Grist et dans `ref:FR:SIRET` sur OpenStreetMap. Les champs actuellement vides et modifiables peuvent être présélectionnés, mais l'utilisateur doit toujours cliquer sur **Appliquer les contacts cochés**.

### Correspondance probable

Le résultat provient de la proximité géographique et de la similitude du nom. Aucun champ n'est présélectionné, même s'il est vide.

## Sécurité

- aucune écriture automatique ;
- aucune valeur existante remplacée sans case cochée ;
- réutilisation de `applyEnrichmentChanges()` pour le contrôle des mappings, des colonnes formule et des écritures Grist ;
- si Téléphone, Courriel ou Site web n'est pas mappé ou modifiable, le champ est désactivé ;
- une indisponibilité ou une limitation Overpass n'empêche pas les fonctions DINUM/IGN de l'Assistant Structures.

## Limites à mesurer

Le but de cette branche est d'évaluer la **couverture réelle** d'OpenStreetMap sur les structures de stage du 44/85. L'absence de résultat n'est pas une erreur : de nombreux établissements n'ont pas de téléphone, courriel, site web ou SIRET renseigné dans OSM.

Le prototype n'est pas fusionné dans `develop` tant que sa pertinence n'a pas été vérifiée sur des structures réelles.
