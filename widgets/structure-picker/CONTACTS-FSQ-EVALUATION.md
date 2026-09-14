# FSQ OS Places — évaluation de la source

## Conclusion

FSQ OS Places reste techniquement une source intéressante pour les contacts publics, mais son mode de diffusion a changé. La source est **retenue comme capacité optionnelle**, sans activation dans le widget ni publication d'index tant qu'un accès officiel authentifié et reproductible n'est pas configuré.

## Schéma utile

Le schéma ouvert fournit notamment `fsq_place_id`, l'identité et l'adresse du lieu, les coordonnées, `tel`, `email`, `website`, les dates de création/rafraîchissement/fermeture, les catégories, `placemaker_url` et `unresolved_flags`.

Le générateur `scripts/generate-fsq-os-places-index.mjs` transforme ce modèle vers le contrat commun des index par département. Il exclut les fiches explicitement fermées (`date_closed`), conserve uniquement les fiches avec au moins un contact, garde l'identifiant FSQ et les signaux qualité, déduplique uniquement un même `fsq_place_id`, puis met à jour uniquement l'entrée `fsq-os-places` du manifest lors d'une génération réelle.

Les `unresolved_flags` ne sont pas traités comme une condamnation définitive : ils doivent être conservés et utilisés ultérieurement pour dégrader la confiance d'un candidat ou demander une vérification plus forte.

## Accès aux données en septembre 2026

Le bucket Parquet S3 public historique a été déprécié au profit du Foursquare Places Portal et de son catalogue Iceberg. L'accès programmatique au portail nécessite un compte et un jeton. Les releases mensuelles restent aussi publiées sur Hugging Face et Snowflake ; le dépôt Hugging Face est désormais gated et requiert l'acceptation de ses conditions puis une authentification.

La release mensuelle visible sur Hugging Face au moment de cette évaluation est `2026-08-11`.

La documentation Foursquare continue d'annoncer un PMTiles `latest` dans le bucket S3 public. Deux vérifications réelles depuis GitHub Actions ont cependant échoué :

1. l'URL HTTPS documentée du PMTiles a répondu `404` ;
2. l'accès S3 anonyme natif (`aws s3 ls ... --no-sign-request`) a lui aussi échoué, sans objet exploitable retourné.

Ces essais montrent que le chemin PMTiles documenté n'est pas actuellement utilisable comme alimentation anonyme reproductible de notre pipeline. En conséquence, aucune mesure de couverture 44/85 n'est présentée : produire des chiffres à partir d'une ancienne copie ou d'un miroir périmé donnerait une fausse impression de validation de la source actuelle.

## Relation avec Overture

Overture Places agrège déjà Foursquare parmi ses fournisseurs amont. Lors de la mesure Overture 44/85 de l'étape 9, 8 821 références de provenance `Foursquare` ont été observées dans les candidats Overture.

Cela impose une règle de provenance : **un contact identique provenant directement de FSQ et d'un candidat Overture portant une lignée Foursquare ne constitue pas deux corroborations indépendantes**. L'identifiant `fsq_place_id` direct devra être rapproché, lorsque possible, du `recordId` de la provenance Foursquare conservée par Overture.

## Décision pour l'architecture

- conserver le générateur FSQ et les tests de normalisation ;
- ne pas déclarer de département FSQ disponible dans `indexed-departments.json` ;
- ne pas activer FSQ dans `contact-search.js` ;
- ne pas introduire de secret ou de jeton dans le dépôt ;
- si un accès Foursquare/Hugging Face authentifié est retenu plus tard, le jeton devra être fourni par le mécanisme de secrets du workflow de génération ;
- avant activation, réaliser alors une vraie mesure 44/85 et comparer le gain marginal par rapport à Overture, qui contient déjà une composante Foursquare.

Cette décision évite d'ajouter une dépendance authentifiée tant que son gain réel sur notre cas d'usage n'est pas démontré.
