# Adresses officielles et bâtiments démontrés

Cet index complète les POI ATP/Overture et les points FINESS/OSM. Il ne localise pas un SIRET par le bâtiment le plus proche. Il conserve une chaîne publique **adresse exacte BAN → relation foncière BDNB → construction unique → identifiant et emprise RNB**. Le SIRET est rattaché seulement au moment de la résolution, après confirmation de son identité et comparaison stricte de son adresse actuelle.

## Données publiées

Extraction du 26 octobre 2026. Couverture : l’ensemble des 20 adresses BAN de la voie `85280_0250`, sans filtre de nom, de SIRET ou d’activité. Les 20 relations BDNB, 16 groupes et 26 bâtiments RNB sont conservés dans la capture de régression complète. Six adresses satisfont les exigences, réparties en cinq fichiers par code postal et numéro. Le fichier `85300/10.json` contient les bâtiments distincts des numéros **10 et 10bis** ; le suffixe reste obligatoire dans la sélection.

- BAN/IGN : WFS public `BAN.DATA.GOUV:ban`, adresses certifiées par la commune, identifiants d’adresse et types de position natifs.
- BDNB : schéma API `api_open_202602a_1`, vérifié dans la réponse `Content-Profile`. Relations d’adresse complètes, adresse principale, qualité de l’emprise, constructions et référence RNB explicite.
- RNB : API publique, statut actif/construit, point WGS84 et emprise du bâtiment, identifiants externes et leurs versions/dates. L’extraction actuelle ne prétend pas que la géométrie vient d’être relevée.
- Licence Ouverte 2.0 pour ces trois sources. Aucun propriétaire, utilisateur ou éditeur de bâtiment n’est publié dans cet index.

## Admission d’une position

L’identité doit être `MATCH_VERIFIED`. Le code postal, la commune, la voie, le numéro et son suffixe doivent correspondre exactement à l’adresse officielle et à l’adresse demandée lorsqu’elle est renseignée. `B` et `BIS` suivent l’équivalence SIRENE existante ; **10 ne devient jamais 10bis**.

La BAN doit certifier l’adresse et qualifier son point comme entrée ou bâtiment. Ce point sert uniquement de référence d’adressage. Une voie, un lieu-dit, une position inconnue ou une boîte aux lettres ne fournit pas une position finale.

La relation BDNB doit être unique parmi toutes les relations de l’adresse, désigner l’adresse principale exacte du groupe et présenter un score de 17 à 20. D’après la [définition officielle du score](https://bdnb.io/schema/latest/bdnb_v07/tables/rel_batiment_groupe_adresse.html), un score supérieur à 15 nécessite les deux critères à cinq points : adresse sur l’unité foncière et adresse foncière d’un bâtiment de cette unité. Cela n’est pas un score de probabilité ni une permission de choisir un voisin. Les autres exigences restent indépendantes : groupe fiable, géométrie non fictive, une seule construction et référence RNB concordante.

Le RNB doit être actif et construit. Ses adresses, lorsqu’elles existent, doivent inclure l’adresse recherchée. Le point publié RNB **et** le point BDNB doivent être strictement à l’intérieur d’une seule emprise polygonale réelle, hors trous et limites. Plusieurs constructions, relations concurrentes, géométries fictives ou composantes distinctes entraînent l’abstention. Un désaccord avec une autre position déjà démontrée reste traité par le résolveur commun.

La position a le niveau `SITE_CORROBORATED`, avec la précision **point de bâtiment**. Il s’agit d’une liaison corroborée par l’adresse officielle et les référentiels de bâtiments, sans prétendre que le RNB porte directement le SIRET ou qu’un nouveau relevé GPS a été effectué. La preuve complète reste consultable et s’écrit avec le SIRET et la paire de coordonnées dans Grist.

## Régénération

```sh
node scripts/generate-address-building-index.mjs \
  --streets 85280_0250 \
  --bdnb-version 202602a_1 \
  --snapshot /tmp/address-building-snapshot.json
```

`--streets` accepte une liste d’identifiants de voies BAN, séparés par des virgules. L’extraction évalue toutes leurs adresses, jamais une liste de commerces. Les requêtes exactes BDNB évitent les scans `LIKE`, et la pagination respecte le plafond réellement annoncé par l’API publique, qui peut être inférieur à la taille demandée. Les appels sont limités en concurrence et ne se produisent jamais pendant une analyse Grist.

Rejeu de la capture complète du dépôt :

```sh
node scripts/generate-address-building-index.mjs \
  --input widgets/structure-picker/tests/fixtures/address-building-snapshot.json
```

Une source incomplète, une pagination répétée, un schéma différent ou un fichier dépassant 96 Kio bloque le remplacement des données. Le navigateur lit au maximum un petit fichier par établissement, en parallèle des autres index, sous leur délai commun. Une réponse tardive ne peut enrichir une autre sélection. Hors couverture ou en cas d’échec, aucune position de remplacement n’est inventée.
