# Captures publiques de lieux

Ces fichiers réduisent la latence de recherche et conservent les observations géographiques des index publics Overture déjà publiés. Ils sont découpés par code postal et premier chiffre du numéro de voie (`none` si absent), avec une limite de 256 Kio par fichier. Ils contiennent **tous** les enregistrements nommés, adressés et géolocalisés des captures fournies, sans sélection de structures, de SIRET ou de résultats attendus.

Chaque observation conserve son identifiant de lieu, son nom, son adresse, sa position et son lien public. L’en-tête conserve l’empreinte SHA-256 du fichier source complet, sa date et sa version amont. La capture locale ne rajeunit pas la source. Le résolveur applique les mêmes contrôles d’identité, d’adresse et de contradiction qu’aux données distantes. Une observation mise en cache ne constitue jamais une décision.

Régénération depuis des captures complètes :

```sh
node scripts/generate-public-poi-cache.mjs /chemin/overture-*.json
```

Tous les fichiers sont validés avant remplacement des communes concernées. Les sources locales sont évaluées ensemble ; les index distants restent disponibles en repli lorsqu’aucune position n’est établie.
