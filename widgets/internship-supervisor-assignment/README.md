# Répartition des suivis de stage

Widget Grist pour affecter automatiquement les stages aux enseignants à partir de quotas exacts définis par enseignant, classe et période.

## Version 1.1.1

La V1.1.1 utilise désormais la configuration native de Grist pour la source principale du widget.

### Source de données native : Classe

Dans le panneau de droite de Grist :

1. choisir **Classe** comme source de données du widget ;
2. associer le champ **Classe** à la colonne qui contient le libellé de la classe ;
3. associer le champ **Nombre de périodes de stage** à la colonne correspondante ;
4. utiliser **Select By / Sélectionner par** avec la vue Classe souhaitée.

Ces deux champs sont déclarés comme mappings obligatoires par le widget via l'API native Grist. Ils ne sont plus configurés dans le menu ⚙ du widget.

La ligne sélectionnée dans la vue Classe devient automatiquement la classe courante.

### Périodes compactes

Seules les périodes réellement définies par le champ natif **Nombre de périodes de stage** sont proposées. Une ou plusieurs périodes peuvent être cochées.

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

### Tables secondaires

Les noms des tables restent fixes :

- `Classe` — source principale native ;
- `Eleves` ;
- `Enseignant` ;
- `Affectation` ;
- `Stage`.

Le bouton **⚙ Réglages** ne configure plus la source `Classe`. Il sert uniquement à choisir, lorsque nécessaire, les colonnes des tables secondaires :

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

Ces mappings secondaires sont détectés automatiquement dans le fichier actuel et mémorisés dans les options du widget.

### Optimisation

Les critères d'optimisation restent dans le panneau **⚙ Réglages** afin de garder l'interface principale compacte.

La V1.1.1 conserve :

- diversification des enseignants entre les périodes d'un même élève ;
- priorité Faible / Moyenne / Forte.

La proximité géographique reste prévue pour une évolution ultérieure.

### Sécurité des écritures

- les suivis déjà renseignés ne sont jamais écrasés ;
- les quotas doivent être exacts ;
- une proposition est prévisualisée avant écriture ;
- les données sont relues avant application ;
- une modification intervenue entre la prévisualisation et l'application invalide la proposition ;
- un changement du mapping natif de la source `Classe` invalide également la proposition ;
- les écritures utilisent les colonnes secondaires réellement configurées.

## Prévisualisation develop

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

## Tests

```bash
npm run test:internship-supervisor-assignment
```
