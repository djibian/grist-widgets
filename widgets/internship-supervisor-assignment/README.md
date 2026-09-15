# Répartition des suivis de stage

Widget Grist pour affecter automatiquement les stages aux enseignants à partir de quotas exacts définis par enseignant, classe et période.

## État stable

Les règles métier de base correspondent à la version fonctionnelle **V1.1.4**. L’évolution V2 ajoute un critère de **proximité géographique** sans modifier les invariants de sécurité : quotas exacts, prévisualisation et absence d’écrasement des suivis existants.

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

Toutes les opérations suivantes sont strictement limitées aux périodes cochées : contrôle et création des stages, contrôle des quotas, génération de la proposition et application des affectations.

### Création des stages manquants

Le widget calcule l’ensemble attendu `élèves de la classe × périodes sélectionnées` et le compare aux lignes de `Stage`. Les doublons élève × période bloquent la création et l’affectation.

### Tables secondaires

Les noms des tables principales restent fixes : `Classe`, `Eleves`, `Enseignant`, `Affectation` et `Stage`.

Le panneau **Paramètres** sert à choisir, lorsque nécessaire, les colonnes métier de ces tables. Les mappings secondaires sont détectés automatiquement dans le fichier actuel et mémorisés dans les options du widget.

### Optimisation

Deux critères sont activés par défaut :

- **Proximité géographique — priorité Forte** : privilégie, dans le respect strict des quotas, les enseignants dont le domicile est proche de la structure de stage ;
- **Diversifier les enseignants — priorité Moyenne** : évite autant que possible qu’un même enseignant suive plusieurs périodes du même élève.

Le calcul géographique utilise une distance directe Haversine. Il respecte la structure réelle du document :

- `Enseignant.Adresse` contient l’adresse du domicile ; elle est géocodée à la volée via le service de géocodage GeoPF au moment du calcul, sans écrire de coordonnées dans Grist ;
- `Stage.Structure_de_stage` référence `Structures_de_stage` ;
- `Structures_de_stage.Latitude` et `Structures_de_stage.Longitude` fournissent les coordonnées déjà enregistrées des structures.

Le résultat du géocodage des enseignants est conservé en mémoire pendant la session afin d’éviter les appels répétés. Si une adresse enseignant ne peut pas être géocodée ou si une structure n’a pas de coordonnées exploitables, le calcul géographique est bloqué avec un message explicite.

Les distances sont affichées dans la proposition, avec une moyenne et un maximum.

### Sécurité des écritures

- les suivis déjà renseignés ne sont jamais écrasés ;
- les quotas doivent être exacts ;
- une proposition est prévisualisée avant écriture ;
- les données sont relues avant application ;
- une modification intervenue entre la prévisualisation et l’application invalide la proposition ;
- un changement du mapping natif de `Classe` invalide également la proposition ;
- lorsque la proximité est active, les adresses enseignants sont re-géocodées/revalidées et les coordonnées des structures sont relues avant application ;
- les écritures utilisent les colonnes secondaires réellement configurées.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

## Tests

```bash
npm run test:internship-supervisor-assignment
```

L’ensemble du dépôt peut également être testé avec `npm test`.
