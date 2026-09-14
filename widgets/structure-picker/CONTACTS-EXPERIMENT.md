# Expérience — contacts publics multi-source

Cette fonctionnalité expérimentale enrichit facultativement les structures avec **Téléphone**, **Courriel** et **Site web** sans modifier le moteur stable de l'Assistant Structures.

L'interface et l'orchestration sont indépendantes des sources : plusieurs sources publiques pourront contribuer à la même recherche, leurs résultats seront classés et dédupliqués, et une source indisponible ne bloquera pas les autres. **OpenStreetMap est actuellement la seule source interrogée par le widget.**

## Stratégie actuelle — OpenStreetMap

1. Si la ligne Grist possède un SIRET, interroger OpenStreetMap par `ref:FR:SIRET`.
2. Si aucun contact exploitable n'est trouvé, et si un nom + des coordonnées sont disponibles, chercher dans un rayon de 300 m les objets OSM nommés qui publient au moins un contact.
3. Convertir les résultats dans le modèle commun, puis appliquer la déduplication exacte et le classement commun avant affichage.

Endpoint Overpass : `https://overpass-api.de/api/interpreter`.

## Index statiques par département

Les sources volumineuses (All The Places, Overture Places, FSQ OS Places et BANCO) sont préparées hors navigateur sous forme d'index JSON statiques par département.

Le fichier `contact-indexes/indexed-departments.json` est le contrat de disponibilité : pour chaque source, il contient un patron de chemin relatif et la liste des départements effectivement publiés. Une source ne doit tenter de charger que l'intersection entre cette liste et les départements actifs du widget Grist.

Contraintes du contrat V1 :

- schéma versionné (`schemaVersion: 1`) ;
- chemins relatifs au répertoire du manifest, sans URL externe ni traversée `..` ;
- aucun département n'est supposé disponible tant qu'il n'est pas déclaré dans le manifest ;
- chargement du manifest avec `cache: "no-store"` ;
- aucun cache applicatif ou service worker.

## Générateur All The Places

`scripts/generate-all-the-places-index.mjs` est le premier générateur réel. Il lit les `FeatureCollection` GeoJSON de l'export officiel All The Places, puis :

1. retient les POI français appartenant aux départements demandés ;
2. écarte les POI ne fournissant ni téléphone, ni courriel, ni site web ;
3. conserve l'identité utile (`name`, adresse, SIRET lorsqu'il existe, coordonnées) et la provenance ATP (`id`, spider, ref, URI source) ;
4. déduplique uniquement les identifiants ATP identiques, en conservant la variante la plus riche en contacts ;
5. écrit un fichier compact par département ;
6. met à jour dans le manifest uniquement la disponibilité de `all-the-places`.

Le générateur ne télécharge rien et n'exécute aucune commande système. Pour un export officiel :

```sh
curl -L https://data.alltheplaces.xyz/runs/latest.zip -o /tmp/alltheplaces.zip
unzip -q /tmp/alltheplaces.zip -d /tmp/alltheplaces
npm run generate:contacts:atp -- --input /tmp/alltheplaces --departments 44,85
```

On peut ajouter `--run-id <identifiant>` pour conserver l'identifiant du run ATP dans chaque index. Le téléchargement et l'exécution périodique seront automatisés seulement à l'étape 12.

Format produit :

```json
{
  "schemaVersion": 1,
  "source": "all-the-places",
  "department": "44",
  "generatedAt": "...",
  "upstream": { "project": "All The Places", "runId": "..." },
  "recordCount": 123,
  "records": []
}
```

La Corse reste volontairement non déduite à partir d'un seul code postal `20xxx`, car ce code ne permet pas de distinguer sûrement `2A` de `2B`.

## Mesure All The Places — 44 / 85

Une mesure complète a été effectuée sur le run ATP `2026-09-05-13-32-25` en parcourant l'archive officielle puis en appliquant le générateur réel aux POI des départements 44 et 85.

Résultat : **5 483 enregistrements uniques avec au moins un contact**, dont :

- **4 675 avec téléphone (85,3 %)** ;
- **1 546 avec courriel (28,2 %)** ;
- **4 198 avec site web (76,6 %)** ;
- **0 avec SIRET** parmi les enregistrements retenus.

Les coordonnées sont présentes sur environ 97 à 98 % des fiches indexées et l'adresse est exploitable sur toutes les fiches retenues. La couverture est particulièrement forte sur les enseignes et réseaux disposant de localisateurs publics.

**Décision : All The Places est retenu comme source complémentaire**, mais pas comme source d'identité primaire. En l'absence de SIRET, le rapprochement devra principalement s'appuyer sur adresse + coordonnées + nom et produire généralement un niveau de confiance `Probable`. Les autres sources indexées restent nécessaires pour élargir la couverture et corroborer les propositions.

Le détail de la mesure, ses limites et sa méthode sont consignés dans `CONTACTS-ATP-COVERAGE.md`. Cette mesure évalue la densité de contacts disponible dans ATP ; elle ne mesure pas encore le taux de correspondance avec les structures effectivement présentes dans un document Grist.

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
- réutilisation de `applyEnrichmentChanges()` pour les écritures Grist ;
- si Téléphone, Courriel ou Site web n'est pas mappé ou modifiable, le champ est désactivé ;
- une indisponibilité d'une source de contacts n'empêche pas les fonctions DINUM/IGN.

## Limites restantes

All The Places montre une densité de contacts suffisante pour être conservé dans l'architecture. La prochaine comparaison devra vérifier si Overture Places élargit la couverture ou apporte une corroboration utile, avant de brancher les sources indexées dans l'interface.

La fonctionnalité conserve explicitement le statut **Expérimental** tant que sa pertinence n'a pas été vérifiée sur des structures réelles.
