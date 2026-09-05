# Répartition des suivis de stage

Widget Grist pour affecter automatiquement les stages aux enseignants à partir de quotas exacts définis par enseignant, classe et période.

## Structure attendue

Classe :
- Classe : libellé ;
- Nombre_de_periodes_de_stage : entier de 1 à 4.

Affectation :
- Enseignant : référence vers Enseignant ;
- Classe : référence vers Classe ;
- Periode : numéro de période ;
- Nombre_de_stages_a_suivre : quota exact.

Stage :
- Eleve : référence vers Eleves ;
- Classe : référence vers Classe, idéalement calculée avec l'élève ;
- Periode : numéro de période ;
- Suivi_par : référence vers Enseignant et colonne modifiable.

Une ligne Affectation représente un quota exact Enseignant × Classe × Période. Le widget ne modifie que Stage.Suivi_par.

## Fonctionnement V1

- une classe à la fois ;
- seules les périodes définies dans Classe.Nombre_de_periodes_de_stage sont proposées ;
- une ou plusieurs périodes peuvent être sélectionnées ;
- les quotas doivent être cohérents avec le nombre de stages ;
- les affectations existantes sont conservées et déduites des quotas ;
- le critère de diversité évite autant que possible qu'un enseignant suive plusieurs périodes du même élève ;
- la proposition est prévisualisée avant toute écriture ;
- les données sont relues au moment d'appliquer : si elles ont changé, l'écriture est refusée.

Le widget n'offre volontairement aucun bouton de réinitialisation.

## Contrôles bloquants

Le calcul est notamment refusé en cas de :
- quota total différent du nombre de stages ;
- doublon Enseignant × Classe × Période dans Affectation ;
- quota négatif ou non entier ;
- période inexistante ;
- plusieurs stages pour le même élève et la même période ;
- affectation existante vers un enseignant non autorisé ;
- affectations existantes dépassant déjà le quota.

## V2 géographique

L'interface réserve un critère Proximité géographique, désactivé en V1. Il pourra être activé lorsque les coordonnées des enseignants seront disponibles. Les niveaux Faible / Moyenne / Forte permettront alors de pondérer les critères concurrents.

Prévisualisation GitHub Pages :
https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/
