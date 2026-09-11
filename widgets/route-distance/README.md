# Distance routière IGN

Widget Grist distinct permettant de calculer, ligne par ligne, la distance routière entre un **domicile de départ fixe** et les domiciles de plusieurs élèves.

## Fonctionnement

- le point de départ reste volontairement défini dans `app.js` par `DOMICILE_LATITUDE` et `DOMICILE_LONGITUDE` ;
- la destination provient des colonnes Latitude et Longitude de la ligne Grist sélectionnée ;
- le calcul utilise le service partagé `shared/services/ign-route.js`, basé sur le service d’itinéraire de la Géoplateforme IGN et le réseau BD TOPO® ;
- la distance obtenue est enregistrée dans la colonne Grist associée ;
- la durée estimée peut être enregistrée dans une colonne facultative.

Le service partagé est prévu pour être réutilisé ultérieurement par d’autres widgets, notamment pour les distances entre domiciles d’enseignants et structures de stage.

## Sécurité d’écriture

Le contexte de calcul (identifiant de ligne, coordonnées et colonnes cibles) est capturé **avant** l’appel réseau. Si l’utilisateur change de ligne pendant le calcul, le résultat reste écrit sur la ligne qui a déclenché le calcul et ne peut pas être appliqué à la nouvelle sélection.

## Mappings Grist

Associer dans le panneau de droite :

- Nom et prénom ;
- Adresse normalisée ;
- Latitude ;
- Longitude ;
- Distance routière (km) ;
- éventuellement Durée estimée (min).

## Évolution prévue

L’origine est encore codée en dur. Une évolution ultérieure permettra de saisir une adresse de départ dans l’interface puis de la valider/géocoder avant calcul ; elle ne fait pas partie de cette version.

## Tests

`npm run test:route-distance`
