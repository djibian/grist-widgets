# Répartition des suivis de stage

Widget Grist pour affecter automatiquement les stages aux enseignants à partir de quotas exacts définis par enseignant, classe et période.

## État stable

Les règles métier de base correspondent à la version fonctionnelle **V1.1.4**. L’évolution V2 ajoute un critère optionnel de **proximité géographique** sans modifier les invariants de sécurité : quotas exacts, prévisualisation et absence d’écrasement des suivis existants.

### Source de données native : Classe

Dans le panneau de droite de Grist :

1. choisir **Classe** comme source de données du widget ;
2. associer le champ **Classe** à la colonne qui contient le libellé de la classe ;
3. associer le champ **Nombre de périodes de stage** à la colonne correspondante ;
4. utiliser **Select By / Sélectionner par** avec la vue Classe souhaitée.

Ces deux champs sont déclarés comme mappings obligatoires par le widget via l’API native Grist. Ils ne sont pas configurés dans le panneau **Paramètres** du widget.

La ligne sélectionnée dans la vue Classe devient automatiquement la classe courante.

### Périodes

Seules les périodes réellement définies par le champ natif **Nombre de périodes de stage** sont proposées. Une ou plusieurs périodes peuvent être cochées.

Toutes les opérations suivantes sont strictement limitées aux périodes cochées :

- contrôle des stages ;
- création des stages manquants ;
- contrôle des quotas ;
- génération de la proposition ;
- application des affectations.

### Création des stages manquants

Le widget calcule l’ensemble attendu :

`élèves de la classe × périodes sélectionnées`

Il compare cet ensemble aux lignes de la table `Stage`. Les lignes manquantes peuvent être créées explicitement en une opération groupée. Seules les colonnes configurées comme **Élève** et **Période** sont renseignées ; les autres colonnes restent vides ou sont calculées par Grist.

Les doublons élève × période bloquent la création et l’affectation.

### Tables secondaires

Les noms des tables principales restent fixes :

- `Classe` — source principale native ;
- `Eleves` ;
- `Enseignant` ;
- `Affectation` ;
- `Stage`.

Le panneau **Paramètres** sert à choisir, lorsque nécessaire, les colonnes de ces tables secondaires :

**Eleves**
- classe de l’élève ;
- identité de l’élève.

**Enseignant**
- identité de l’enseignant.

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

Deux critères peuvent être combinés, chacun avec une priorité **Faible / Moyenne / Forte** :

- **Diversifier les enseignants** : évite autant que possible qu’un même enseignant suive plusieurs périodes du même élève ;
- **Proximité géographique** : privilégie, dans le respect strict des quotas, les enseignants dont le domicile est géographiquement proche de la structure de stage.

La proximité est **désactivée par défaut** afin de ne pas modifier silencieusement les répartitions existantes.

Le calcul géographique utilise une distance directe sur la sphère terrestre (Haversine), sans appel réseau. Il s’appuie sur les colonnes techniques du document actuel :

- `Enseignant.Latitude` et `Enseignant.Longitude` pour le domicile de l’enseignant ;
- `Stage.Structure` comme référence vers `Structures_de_stage` ;
- `Structures_de_stage.Latitude` et `Structures_de_stage.Longitude` pour la structure de stage.

Lorsque la proximité est activée, toute nouvelle affectation à calculer doit disposer de coordonnées exploitables côté enseignant et côté structure. Sinon le calcul est bloqué avec un message explicite. Les distances sont affichées dans la proposition, avec une moyenne et un maximum.

### Sécurité des écritures

- les suivis déjà renseignés ne sont jamais écrasés ;
- les quotas doivent être exacts ;
- une proposition est prévisualisée avant écriture ;
- les données sont relues avant application ;
- une modification intervenue entre la prévisualisation et l’application invalide la proposition ;
- un changement du mapping natif de la source `Classe` invalide également la proposition ;
- les changements de coordonnées des enseignants ou structures invalident aussi une proposition géographique déjà calculée ;
- les écritures utilisent les colonnes secondaires réellement configurées.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

## Tests

```bash
npm run test:internship-supervisor-assignment
```

L’ensemble du dépôt peut également être testé avec `npm test`.
