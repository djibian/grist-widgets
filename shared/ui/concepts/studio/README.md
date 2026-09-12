# Grist Studio — concept d’identité visuelle

Prototype exploratoire isolé pour tester une évolution de l’identité commune des widgets sans modifier les interfaces actuellement publiées.

## Intention

L’interface existante est cohérente et sobre, mais reste proche d’une bibliothèque de composants générique de type Linear. Ce concept cherche une identité plus propre au dépôt et plus directement utile dans Grist :

- un **canvas calme** et des surfaces de travail très lisibles ;
- une palette **encre + jade** pour donner une signature reconnaissable sans surcharge ;
- une structure commune **contexte → travail → validation** ;
- un bandeau de contexte Grist toujours visible pour réduire les erreurs de portée ;
- une seule action principale clairement identifiable ;
- les différences et conséquences d’une écriture montrées avant validation ;
- des accents secondaires par famille d’usage (données, organisation, géographie) sans changer de système visuel ;
- une densité adaptée à un widget embarqué plutôt qu’à une application pleine page.

## Démonstrateur

`index.html` contient trois variations interactives utilisant le même langage :

1. Assistant structures ;
2. Affectation des suivis de stage ;
3. Distance routière IGN.

Le sélecteur supérieur permet de vérifier la cohérence du système entre des tâches très différentes.

## Ce que ce prototype ne fait pas

- il ne remplace pas `shared/ui` ;
- il ne modifie aucun widget existant ;
- il n’introduit aucune dépendance ou étape de build ;
- il ne constitue pas encore une spécification finale de composants.

Si la direction est retenue, l’étape suivante est de traduire les motifs validés en tokens et composants `gw-*`, puis de migrer un widget pilote avant généralisation.
