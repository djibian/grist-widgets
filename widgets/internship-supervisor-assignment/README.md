# Répartition des suivis de stage

Widget Grist pour affecter les stages aux enseignants à partir de quotas exacts définis par enseignant, classe et période.

## V2 — proximité géographique

La V2 conserve les invariants de la version stable : quotas exacts, suivis existants préservés, prévisualisation avant écriture et relecture des données avant application. Elle ajoute une optimisation géographique fondée sur des localisations préparées et validées dans Grist.

### Source principale : Classe

Dans le panneau de droite de Grist :

1. sélectionner la table `Classe` comme source du widget ;
2. associer **Classe** à la colonne de libellé ;
3. associer **Nombre de périodes de stage** à la colonne correspondante ;
4. relier le widget à la vue Classe avec **Select By / Sélectionner par**.

La ligne sélectionnée devient la classe courante. Seules les périodes réellement définies pour cette classe sont proposées.

### Données géographiques

Le widget Affectation **ne géocode aucune adresse**. Les enseignants sont géolocalisés et contrôlés au préalable dans la page Enseignants, avec le géocodeur dédié du document.

Lorsque la proximité est activée, Affectation utilise :

- `Enseignant.Latitude` ;
- `Enseignant.Longitude` ;
- `Enseignant.Localisation_validee` ;
- `Stage.Structure_de_stage`, référence vers `Structures_de_stage` ;
- `Structures_de_stage.Latitude` ;
- `Structures_de_stage.Longitude`.

Ces colonnes sont des mappings explicites : leur présence, leur type et la référence `Stage → Structures_de_stage` sont contrôlés par le widget.

Une localisation enseignant n'est exploitable que si `Localisation_validee` est vraie et si latitude/longitude sont numériques et dans les bornes géographiques valides. Une structure doit être renseignée sur le stage et posséder elle aussi des coordonnées valides.

Avant le calcul, le widget affiche un précontrôle du type :

`2/2 enseignants localisés et validés · 20/20 structures exploitables`

Toute incohérence bloque l'optimisation géographique avec un message précis.

### Quotas et stages

Le widget calcule l'ensemble attendu :

`élèves de la classe × périodes sélectionnées`

Les lignes `Stage` manquantes peuvent être créées explicitement. Les doublons élève × période bloquent le calcul.

Pour chaque période sélectionnée :

- la somme des quotas doit être exactement égale au nombre d'élèves ;
- les suivis déjà renseignés sont conservés et déduits des quotas restants ;
- un enseignant déjà au-dessus de son quota ou non autorisé pour la classe bloque le calcul.

### Solveur d'affectation

L'ancien choix glouton par ordre de lignes est remplacé par un **solveur d'affectation à coût minimal sous capacités**.

Pour chaque période, le solveur recherche globalement l'affectation de coût minimal entre tous les stages non affectés et tous les enseignants ayant encore du quota. Il peut donc faire un choix localement moins avantageux pour un stage si cela améliore fortement la solution globale.

Le widget évalue ensuite les différents ordres possibles des périodes sélectionnées — au maximum quatre — afin de prendre en compte la diversification entre les périodes d'un même élève.

Cette V2 est donc exacte pour l'affectation **à l'intérieur de chaque période**. L'optimisation globale de tournées multi-périodes et multi-classes appartient aux évolutions suivantes.

### Critères et priorités

Deux critères sont activés par défaut :

1. **Proximité géographique — Forte** ;
2. **Diversifier les enseignants — Moyenne**.

La géographie conserve la magnitude réelle des distances : aucune normalisation « meilleur = 0 / pire = 1 » n'est appliquée. Le coût utilise la distance directe Haversine en kilomètres.

Les niveaux de priorité utilisent les facteurs suivants :

- **Faible** : × 0,5 ;
- **Moyenne** : × 1 ;
- **Forte** : × 2.

Une répétition enseignant–élève possède une pénalité de base équivalente à 10 unités de coût, modulée par la priorité de diversification. Le widget affiche dans chaque proposition la traduction concrète du compromis dans la configuration courante.

Avec les réglages par défaut — Géographie Forte, Diversification Moyenne — éviter une répétition pèse autant qu'environ **5 km de distance directe**. Au-delà de cet écart, la proximité géographique l'emporte.

Cette équivalence est volontairement explicite afin que le comportement du moteur soit compréhensible et ajustable.

### Résultats

La prévisualisation affiche notamment :

- les affectations proposées ;
- la distance directe de chaque affectation ;
- la distance totale, moyenne et maximale ;
- le nombre de répétitions enseignant–élève ;
- le contrôle des quotas ;
- l'équivalence entre diversification et distance correspondant aux priorités choisies.

### Sécurité des écritures

- aucun suivi existant n'est écrasé ;
- le calcul est prévisualisé avant toute écriture ;
- les données sont relues avant application ;
- une modification des stages, quotas, coordonnées, validation géographique ou mappings invalide la proposition ;
- seules les colonnes réellement configurées sont écrites.

## Évolutions prévues

Le socle V2 prépare deux évolutions distinctes :

1. **tournées de visites en voiture** : compléter la distance directe par les distances et durées routières GeoPF/IGN, puis favoriser des groupes de structures compacts pour chaque enseignant ;
2. **plusieurs classes simultanément en stage** : prendre en compte les suivis déjà affectés dans d'autres classes lorsqu'ils peuvent être visités dans la même fenêtre temporelle, notamment à partir des dates de fin de stage.

Ces évolutions devront conserver les quotas et affectations existantes comme contraintes fortes et limiter les appels routiers aux couples réellement pertinents.

## Version publiée

`https://djibian.github.io/grist-widgets/widgets/internship-supervisor-assignment/`

## Tests

```bash
npm run test:internship-supervisor-assignment
```

L'ensemble du dépôt peut également être testé avec `npm test`.
