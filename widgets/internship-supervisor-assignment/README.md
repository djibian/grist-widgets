# Répartition des suivis de stage

Widget Grist pour affecter automatiquement les stages aux enseignants à partir de quotas exacts définis par enseignant, classe et période.

## Version 1.1

La V1.1 renforce l'intégration au document Grist sans introduire encore l'optimisation géographique.

### Classe pilotée par Grist

Le widget doit être associé à la table `Classe` et peut être piloté par la vue Classe grâce à **Select By**. La classe n'est plus choisie dans le widget : la ligne sélectionnée dans la vue Classe devient automatiquement le périmètre courant.

### Périodes compactes

Seules les périodes réellement définies par la colonne configurée comme **Nombre de périodes de stage** sont proposées. Une ou plusieurs périodes peuvent être cochées.

Toutes les opérations suivantes sont strictement limitées aux périodes cochées :

- contrôle des stages ;
- création des stages manquants ;
- contrôle des quotas ;
- génération de la proposition ;
- application des affectations.

### Création des stages manquants

Le widget calcule l'ensemble attendu :

`élèves de la classe × périodes sélectionnées`

Il compare cet ensemble aux lignes de la table `Stage`. Les lignes manquantes peuvent être créées explicitement en une opération groupée. Seules les colonnes configurées comme **Élève** et **Période** sont renseignées ; les autres colonnes restent vides ou sont calculées par Grist.

Les doublons élève × période bloquent la création et l'affectation.

### Paramétrage des colonnes

Les noms des cinq tables restent fixes :

- `Classe` ;
- `Eleves` ;
- `Enseignant` ;
- `Affectation` ;
- `Stage`.

Le bouton **⚙ Réglages** permet de choisir les colonnes utilisées pour chaque rôle fonctionnel. Le paramétrage est mémorisé dans les options du widget.

Les colonnes attendues sont :

**Classe**
- libellé de la classe ;
- nombre de périodes de stage.

**Eleves**
- classe de l'élève ;
- identité de l'élève.

**Enseignant**
- identité de l'enseignant.

**Affectation**
- enseignant ;
- classe ;
- période ;
- nombre de stages à suivre.

**Stage**
- élève ;
- période ;
- suivi par.

La V1.1 détecte automatiquement les noms utilisés dans le fichier actuel, notamment les variantes singulier/pluriel de `Nombre de stage(s) à suivre`.

### Optimisation

Les critères d'optimisation ont été déplacés dans le panneau **⚙ Réglages** afin de garder l'interface principale compacte.

La V1.1 conserve :

- diversification des enseignants entre les périodes d'un même élève ;
- priorité Faible / Moyenne / Forte.

La proximité géographique reste affichée comme évolution future mais n'est pas active en V1.1.

### Sécurité des écritures

- les suivis déjà renseignés ne sont jamais écrasés ;
- les quotas doivent être exacts ;
- une proposition est prévisualisée avant écriture ;
- les données sont relues avant application ;
- une modification intervenue entre la prévisualisation et l'application invalide la proposition ;
- les écritures utilisent les colonnes réellement configurées, jamais des noms codés en dur.

## Prévisualisation develop

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

## Tests

```bash
npm run test:internship-supervisor-assignment
```
