# Expérience — contacts publics multi-source

Cette fonctionnalité expérimentale enrichit facultativement les structures avec **Téléphone**, **Courriel** et **Site web** sans modifier le moteur stable de l'Assistant Structures.

L'interface et l'orchestration sont désormais indépendantes des sources : plusieurs sources publiques pourront contribuer à la même recherche, leurs résultats seront classés et dédupliqués, et une source indisponible ne bloquera pas les autres. **OpenStreetMap est actuellement la seule source active.**

## Stratégie actuelle — OpenStreetMap

1. Si la ligne Grist possède un SIRET, interroger OpenStreetMap par `ref:FR:SIRET`.
2. Si aucun contact exploitable n'est trouvé, et si un nom + des coordonnées sont disponibles, chercher dans un rayon de 300 m les objets OSM nommés qui publient au moins un contact.
3. Convertir les résultats dans le modèle commun, puis appliquer la déduplication exacte et le classement commun avant affichage.

Endpoint Overpass :

`https://overpass-api.de/api/interpreter`

Les requêtes sont envoyées en POST et restent bornées à une structure ou à un rayon local de 300 m.

## Confiance

Les candidats utilisent trois niveaux communs à toutes les sources :

- **Très fiable** : notamment une correspondance SIRET exacte ;
- **Probable** : faisceau suffisamment fort (adresse, proximité géographique + nom, etc.) ;
- **À vérifier** : proposition utile mais insuffisamment étayée pour être considérée comme probable.

Les champs actuellement vides et modifiables ne sont présélectionnés que pour une correspondance SIRET exacte. L'utilisateur doit toujours cliquer sur **Appliquer les contacts cochés**.

## Provenance et résilience

- chaque proposition conserve la ou les sources qui l'ont produite ;
- les doublons exacts peuvent regrouper plusieurs provenances sans fusionner arbitrairement leurs champs ;
- l'état de chaque source interrogée est visible dans l'interface ;
- l'échec d'une source n'empêche pas d'utiliser les résultats des autres sources disponibles.

## Sécurité

- aucune écriture automatique ;
- aucune valeur existante remplacée sans case cochée ;
- réutilisation de `applyEnrichmentChanges()` pour le contrôle des mappings, des colonnes formule et des écritures Grist ;
- si Téléphone, Courriel ou Site web n'est pas mappé ou modifiable, le champ est désactivé ;
- une indisponibilité d'une source de contacts n'empêche pas les fonctions DINUM/IGN de l'Assistant Structures.

## Limites à mesurer

Le but est d'évaluer la **couverture réelle** des sources publiques sur les structures de stage. L'absence de résultat n'est pas une erreur : de nombreux établissements ne publient pas de téléphone, courriel ou site web dans les sources interrogées.

La fonctionnalité conserve explicitement le statut **Expérimental** tant que sa pertinence n'a pas été vérifiée sur des structures réelles.
