# Résolution d'établissement : audit et preuves reproductibles

Base auditée : `main` `4d96453fdc47e405fec00e30d541a8a02386f111`, après les PR 78, 79 et 80. La branche reprend également les preuves adresse–bâtiment de la PR 81, encore non fusionnée, sans toucher cette PR ni `main`.

## Échec reproduit

Les [traces avant correction](../tests/fixtures/resolution/baseline-traces.json) reproduisent les cinq interruptions à 12 001–12 003 ms en appelant le service utilisé par le véritable contrôleur Grist, avec son callback OSM effectif. Le garde-fou rejetait la promesse et perdait les candidats reçus. Les recherches enchaînaient Annuaire, IGN, recherche Annuaire de voisinage/pagination puis Overpass (requête serveur de 15 s avec plusieurs endpoints), sous un budget global de 12 s. La file Annuaire de 1,8 s et les backoffs n'étaient pas annulables partout. Le chemin de liens publiés pouvait également bloquer la recherche primaire. Un SIRET déjà saisi ne court-circuitait pas tous les appels secondaires.

Le nom public des écoles ou résidences n'est souvent pas celui de leur exploitant OGEC ou CCAS. L'ancien complément FINESS ne pouvait intervenir qu'après découverte d'un candidat probable. Un index inverse de sites officiels manque donc à une recherche exclusivement juridique. Les variantes sans code postal perdaient également leur commune explicitement écrite.

## Captures primaires

Les fichiers [fixtures/resolution](../tests/fixtures/resolution/) contiennent les réponses Annuaire/IGN originales, les requêtes et dates du corpus indépendant, ainsi que les traces d'échec. Les données natives Éducation et FINESS sont publiées dans le catalogue local avec leurs URLs et dates. Les géométries OSM conservent identifiant, version, changeset, date et source. Les réponses d'API capturées sont des preuves de test, jamais des réponses injectées dans la résolution réseau réelle.

Reproduction réseau (mêmes services et callbacks que l'UI ; les nouveaux fichiers statiques sont lus depuis le checkout) :

```sh
node scripts/capture-structure-identity-live.mjs
npm test
```

Le script écrit `artifacts/structure-picker-identity-live.json`, avec réponses réseau brutes, durées, diagnostics, verdicts et preuves. Les sondes exactes de contrôle sont lancées **après** la résolution et ne l'alimentent jamais. L'artefact réseau contient également les grands shards ATP/Overture ; sa synthèse versionnée est [resilient-live-summary.json](resilient-live-summary.json).

## Résultats et limites démontrées le 26 octobre (avant ajustement de la saisie)

- Alliance : UAI `0851256D`, SIRET de site `32548690000062`, exploitant OGEC PRIMAIRE ET MATERNELLE DE CHALLANS. Éducation : 55 boulevard Jean XXIII. OSM node `9934213402` porte `fixme=position exacte à définir` : rejet obligatoire. Les relations BDNB de cette adresse ont plusieurs bâtiments et des scores 12/15 ; aucune construction unique assez étayée. L'identité peut être confirmée, mais aucune position finale n'est démontrée par ces sources.
- Guillonneau : EGE FINESS `850025917`, SIRET `26850050100070`, CCAS, 27 rue de la Gazonnière. OSM way `1098104437`, version 3 du 2024-11-06, porte explicitement ce FINESS, ce SIRET et la catégorie EHPAD 500. Le point intérieur retenu est `46.8389449, -1.881625298666242`. La résidence voisine L'Entracte porte **d'autres** FINESS/SIRET et ne fournit pas ce point.
- Sainte Marie, avec ou sans 44310 : même UAI `0441333K` et site du 9 rue de la Paix, SIRET `78605938600023`. Le SIRET saisi `78605938600015` désigne le siège au **22 rue du Général de Gaulle** ; la correction ne peut être automatique. Après correction explicite, seule l'emprise OSM `way:373841583` contient la référence officielle au numéro de rue ; `way:373842165`, autre implantation du même UAI, est exclue.
- Maison de l'enfance, Legé : le [site municipal](https://www.ville-lege44.fr/grandir-et-vieillir/enfance-jeunesse/maison-de-lenfance/) atteste le lieu, mais aucun SIRET propre à cette adresse n'a été démontré. Les sites Annuaire de la commune incluent la mairie et la halte-garderie au **8 rue Jules Ferry**, pas ce 10ter place du Champ de Foire. Aucun gestionnaire, service voisin ou géocodage d'adresse n'est substitué au site demandé. Selon la disponibilité des sources, verdict d'abstention `NO_MATCH` ou recherche `INCOMPLETE`, avec la raison affichée.
- Les quatre références historiques restent vérifiées : Super U `41091808000020`, Reynerie `26850025300011`, ô Pré d'Vous `89306104400028`, POM `88493583400033`. Leurs points de site/bâtiment déjà démontrés sont conservés.

## Corpus indépendant et négatifs

Le [corpus réel supplémentaire](../tests/fixtures/resolution/diverse-public-services.json) comprend école publique, école privée, collège, lycée, SSIAD associatif, résidence autonomie, IME et SMUR. Les captures exactes Annuaire exposent trois contradictions réelles : école publique au 18/22 rue des Écoles ; IME impasse Paul Éluard/rue des Fresnes ; SMUR Ancenis ayant un SIRET juridiquement rattaché au CHU de Nantes. Le moteur doit s'abstenir dans ces trois cas, même si l'identifiant sectoriel est présent. Les cinq autres chaînes cohérentes sont confirmées. Ces négatifs indépendants empêchent de confondre amélioration de couverture et relâchement des preuves.

Les tests couvrent aussi identifiants corrompus, fermeture, type collège/école et EHPAD/SSIAD, organismes multisites, homonymes, bâtiments voisins et suffixes, coordonnées de rue seules, contradictions entre POI déjà liés, transports ignorant l'annulation, files abandonnées, sélection Grist modifiée, modification concurrente de fiche et application atomique du SIRET avec ses deux coordonnées et leurs preuves. Le véritable module UI est chargé dans un faux hôte Grist instrumenté, sans remplacer le résolveur par une simulation.

Les index locaux couvrent actuellement les départements 44/85, avec complément scolaire national borné au code postal. Ils ne prétendent pas couvrir toute la France ni tous les services municipaux. Les sources publiques peuvent manquer, diverger ou dépasser leur budget ; cela doit produire une abstention expliquée avec les preuves disponibles. Les positions de campus ou de bâtiment ne garantissent pas une entrée accessible ni une précision topographique centimétrique. La validation humaine dans Grist reste nécessaire avant fusion.

## Validation du 26 octobre 2026

`npm test` : **409 tests réussis, aucun échec** (7 partagés, 311 structure-picker, 64 affectation, 20 itinéraires, 7 composition de courriel). La capture réseau finale confirme les quatre références et les identités Alliance/Guillonneau. Les deux variantes Sainte Marie sont refusées à raison (SIRET du siège), avec le site correct en alternative. Legé termine en `INCOMPLETE` en 2,97 s car IGN dépasse son budget de découverte ; aucun SIRET n’est inventé. L’Alliance conserve une abstention de position ; Guillonneau obtient son point de site explicite.

## Validation du 27 octobre : saisie réelle et numéro indicatif

La lecture Grist **sans aucune écriture** a confirmé les champs publics exacts du [corpus de saisie](../tests/fixtures/resolution/grist-inputs-2026-10-27.json). L’Alliance était saisie `55 Bd Jean XXlll, 85300 Challans`, avec trois `l` minuscules, alors que le corpus initial utilisait déjà `XXIII`. Cette différence provoquait le rejet de l’adresse dans le registre scolaire, puis le chemin de repli réseau. Le correctif conserve l’original et normalise uniquement ce motif générique de chiffre romain invalide vers une forme valide. Des négatifs conservent les distinctions `XXII`/`XXIII`, les vrais chiffres `XL`/`LIII`, les numéros de maison et les mots ordinaires.

Le numéro d’immatriculation saisi n’est plus un filtre ni un motif de rejet de l’identité. Les sources officielles restent strictement contrôlées. Les deux Sainte Marie, **sans changer leur SIRET saisi**, sont désormais `MATCH_VERIFIED`, site `78605938600023`, UAI `0441333K`, avec le même point intérieur OSM de `way:373841583`. Le numéro de siège `78605938600015` est seulement signalé. Son remplacement reste décoché ; l’UI permet de sélectionner explicitement cette correction avec la paire de coordonnées et sa preuve dans une même action Grist. Aucun remplacement silencieux ni écriture sur le document réel n’a été effectué.

Les tests reprennent les espaces, apostrophes, accents, communes sans tirets et chiffres romains des cinq fiches réellement présentes. Ils couvrent aussi l’absence de numéro, un SIRET erroné, un SIREN d’un autre organisme, une saisie mal formée, deux homonymes déjà prouvés et l’impossibilité pour un numéro concordant de surmonter une contradiction du nom ou du site. Les preuves et captures du 26 octobre ci-dessus sont conservées comme historique ; la capture de référence après cet ajustement est [registration-hints-live-summary.json](registration-hints-live-summary.json).

La capture réseau du 2026-10-27T16:57:35.948Z confirme les huit fiches pour lesquelles une chaîne de preuves suffisante est disponible, dont les deux Sainte Marie en conservant leur numéro saisi. L’Alliance conserve une abstention de position justifiée ; Legé reste INCOMPLETE (IGN indisponible dans son budget) et ne reçoit aucun SIRET inventé. Les quatre références historiques conservent leurs coordonnées démontrées. Les [réponses publiques du 27 octobre](registration-hints-public-responses.json) sont également versionnées.

Validation automatisée finale du 27 octobre : **418 tests réussis, aucun échec** (7 partagés, 320 structure-picker, 64 affectation, 20 itinéraires et 7 composition). Le numéro seul ne confirme pas un site, un numéro concordant ne départage pas deux homonymes déjà prouvés, et un numéro erroné ne déclenche pas de requête superflue lorsque le nom et l’adresse établissent déjà le candidat.
