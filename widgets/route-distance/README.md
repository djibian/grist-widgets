# Distance routière IGN

Widget Grist permettant de calculer, vérifier puis enregistrer la distance routière entre un **point de départ fixe** et la destination de la ligne sélectionnée.

## Fonctionnement

- le point de départ reste défini dans `app.js` par `DOMICILE_LATITUDE` et `DOMICILE_LONGITUDE` ;
- la destination provient des colonnes Latitude et Longitude de la ligne Grist sélectionnée ;
- le calcul utilise le service partagé `shared/services/ign-route.js`, basé sur le service d’itinéraire de la Géoplateforme IGN et le réseau BD TOPO® ;
- le résultat est affiché sans écriture ;
- l’utilisateur vérifie la distance et la durée avant de cliquer sur **Enregistrer dans Grist** ;
- la durée estimée peut être enregistrée dans une colonne facultative.

Le service partagé est prévu pour être réutilisé par d’autres widgets ayant besoin d’un calcul d’itinéraire.

## Sécurité d’écriture

Le contexte de calcul — identifiant de ligne, coordonnées et colonnes cibles — est capturé avant l’appel réseau.

Si la sélection change pendant le calcul, le résultat n’est pas proposé à l’enregistrement sur la nouvelle ligne. L’utilisateur doit recalculer sur la ligne active. Une écriture n’est possible que si le résultat en attente correspond toujours à la sélection courante.

## Mappings Grist

Associer dans le panneau de droite :

- Nom et prénom ;
- Adresse normalisée ;
- Latitude ;
- Longitude ;
- Distance routière (km) ;
- éventuellement Durée estimée (min).

## Évolution prévue

L’origine est encore codée en dur. Une évolution ultérieure pourra permettre de saisir une adresse de départ dans l’interface puis de la valider et la géocoder avant calcul.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/route-distance/`

## Tests

```bash
npm run test:route-distance
```
