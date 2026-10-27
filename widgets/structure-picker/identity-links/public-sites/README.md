# Sites publics nommés et géolocalisés par leur collectivité

Cet adaptateur accepte les annuaires WordPress publiant une fiche nominative, son adresse et exactement un marqueur cartographique propre. Il exige une attestation indépendante du domaine de la collectivité par Service-Public/DILA. Il ne déduit jamais un SIRET de site depuis celui du gestionnaire.

Exemple de génération d’une cohorte de services municipaux :

```sh
node scripts/generate-public-site-directory.mjs \
  --url https://www.ville-lege44.fr \
  --authority-url https://lannuaire.service-public.gouv.fr/pays-de-la-loire/loire-atlantique/0d6e48f1-a798-497b-9a30-fb7cc6ad5058 \
  --commune 44081 --commune-name Legé --postcode 44650 \
  --label 'Ville de Legé — annuaire officiel' \
  --category services-municipaux
```

Le script vérifie l’énumération complète (actuellement 87 fiches), sélectionne la catégorie native (12 fiches), puis conserve tous les sites locaux dont les données cartographiques propres sont démontrées (6 fiches). Aucune liste de noms ni coordonnées attendues. Une pagination non prise en charge échoue explicitement au lieu de publier une cohorte tronquée. L’option `--cache <répertoire>` est réservée à la génération : réutilisation maximale de cinq minutes, invalidée si le CMS annonce une modification plus récente.

Chaque enregistrement conserve identifiant CMS, URL, date de modification, nom/adresse publiés, coordonnées, extraits HTML natifs et SHA-256 de la page complète. Le dossier DILA conserve les seuls champs permettant de vérifier le domaine et la commune. La date de vérification est distincte de la date de modification. Le runtime exige nom normalisé exact, voie compatible et même commune, conserve les preuves, et distingue un point de site publié d’une entrée, d’un bâtiment ou d’un géocodage de voie.

`MATCH_VERIFIED` avec `identityScope: PUBLIC_SITE` atteste le lieu public, **pas une identité juridique**. Le candidat garde `siret: null` et aucun exploitant présumé. L’UI l’explique ; seules les coordonnées et les preuves peuvent être appliquées, sous relecture concurrente et sans identifiant déjà présent. En cas d’ambiguïté ou de contradiction, aucune position n’est choisie.

La cohorte 44081 est une couverture initiale explicite. D’autres collectivités peuvent être ajoutées par le même adaptateur si leur format et leur attestation satisfont le contrat. Les autres formats nécessitent un adaptateur de source conservant des preuves équivalentes. Il n’existe aucune promesse de couverture nationale automatique.
