# Distance routière IGN

Widget Grist permettant de calculer une distance routière entre un point de départ fixe et les coordonnées de la ligne sélectionnée.

## Fonctionnement

- le point de départ est défini dans `app.js` par `DOMICILE_LATITUDE` et `DOMICILE_LONGITUDE` ;
- la destination provient des colonnes Latitude et Longitude associées dans Grist ;
- le calcul utilise le service d’itinéraire de la Géoplateforme IGN sur le réseau BD TOPO® ;
- la distance obtenue est enregistrée dans la colonne Grist associée ;
- la durée estimée peut être enregistrée dans une colonne facultative.

## Mappings Grist

Associer dans le panneau de droite :

- Nom et prénom ;
- Adresse normalisée ;
- Latitude ;
- Longitude ;
- Distance routière (km) ;
- éventuellement Durée estimée (min).

## Prévisualisation develop

`https://djibian.github.io/grist-widgets/widgets/route-distance/`
