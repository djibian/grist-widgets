# Protocole de validation indépendante — structures inédites

Statut au 15 novembre 2026 : **protocole figé, corpus public à constituer et à figer avant toute mesure**. Les exemples de régression historiques et les 50 pistes synthétiques de `discovery-progress.test.mjs` ne font pas partie de ce corpus. Le chiffre « 50 » ci-dessous est un objectif, **pas un score obtenu**.

## Échantillon et gel

1. Tirer au sort ou sélectionner systématiquement au moins 50 établissements publics ou privés **absents des fixtures, tests, caches spécialisés et corrections historiques du dépôt**, sur au moins dix secteurs (commerce, industrie, artisanat, agriculture, santé, social, enfance, éducation, tourisme, sport, culture, administration).
2. Inclure plusieurs régions, établissements avec et sans immatriculation propre, gestionnaire distinct, plusieurs établissements d'une même entreprise, homonymes dans des communes voisines et lieux dont le SIRET est réellement indéterminé.
3. Avant la première évaluation du moteur, enregistrer un manifeste versionné et sa somme SHA-256 ; relever pour chaque cas un identifiant non nominatif, une entrée utilisateur plausible et les **références publiques indépendantes datées** établissant ou non identité juridique du site, adresse exacte et provenance du point. Une information non vérifiable reçoit le statut `unknown`, jamais une valeur supposée.
4. Faire relire indépendamment les vérités terrain et les conflits par une deuxième personne ou une deuxième méthode. Documenter les ambiguïtés, le changement possible de statut des établissements et la date d'observation.
5. Ne pas modifier le gel après constat d'échec pour favoriser l'algorithme ; les corrections de vérité terrain doivent être historisées comme errata, et toute optimisation ciblée bascule le cas dans un jeu de développement séparé. Ne pas inclure de données personnelles d'élèves.

## Schéma conseillé pour chaque cas (`heldout.jsonl`)

```json
{"id":"H001","sector":"artisanat","input":{"NomCommercial":"…","Adresse":"…","SirenSiret":""},"truth":{"siteSiret":null,"siteSiretStatus":"unknown","legalName":null,"siteAddress":null,"location":{"lat":null,"lon":null,"quality":"unknown"}},"sources":[{"url":"https://…","observedAt":"2026-11-15","supports":["siteAddress"]}],"notes":""}
```

La valeur `siteSiret: null` distingue explicitement `unknown` (vérité non établie) de `none_proven` (preuve d'absence d'immatriculation propre). Aucune coordonnée fournie par simple géocode de rue ne peut valider une **position précise du site**. L'effort enseignant est mesuré par nombre de clics/champs à arbitrer et temps actif approximatif ; le temps de réseau ne compte pas comme effort humain.

## Mesures reproductibles

Exécuter sur **le même corpus et les mêmes captures publiques** le `main` de référence et le HEAD de la PR. Conserver versions, heures, quotas, configuration départementale, réseau/cache et échecs de sources ; distinguer appels HTTP réels des hits cache.

- **Découverte :** rappel@5 des candidats corrects parmi tous les cas à vérité juridique déterminée ; documenter les abstentions par cas.
- **Vérification :** exactitude du SIRET **géographique**, faux rattachements, confusion siège/gestionnaire/site, faux positifs et abstentions.
- **Géographie :** couverture par niveau `site_confirmed`, `site_corroborrated`, adresse approximative et sans position ; précision géographique par seuil documenté **uniquement** sur les points de vérité de même qualité.
- **Enrichissement :** exactitude des champs indépendants et nombre de propositions réellement applicables sans conflit.
- **Performance :** temps jusqu'à première piste, temps jusqu'à preuve, p50/p95/p99, requêtes/API par cas, erreurs HTTP, requêtes refusées, reprises/interruption, effort utilisateur.
- **Protection :** aucune écriture sans action expresse ; aucun SIRET de gestionnaire attribué au site ; aucun géocode de rue promu en site ; changement de fiche et réponses tardives rejetées.

Rapporter numérateurs/dénominateurs, intervalles de confiance quand l'échantillon le permet, et cas `unknown` exclus des métriques qui exigent une vérité terrain. Un gain de rappel ne justifie **jamais** une hausse des faux rattachements dangereux.

## État de mise en œuvre

- Tests existants : historique, incidents, adversaires et conservation de 50 pistes synthétiques.
- Nouveau : guidage de recherche avec tests ciblés et scénarios Grist.
- **Manquants :** collecte/gél du jeu de 50+ structures réelles inédites, capture des sources, runner comparatif, rapports baseline vs PR. Tant qu'ils manquent, **aucune amélioration de généralisation n'est démontrée indépendamment**.

Prochaine opération sur le banc : constituer le manifeste public **sans consulter les résultats de la PR**, le figer, puis automatiser sa lecture et ses métriques avant de modifier à nouveau le classement.
