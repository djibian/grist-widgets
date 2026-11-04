# Réponses officielles datées

Ces captures contiennent les corps HTTP exacts des recherches publiques, leur URL, leur date de consultation et leur empreinte SHA-256. Le lecteur vérifie l’intégrité, l’identifiant et l’état actif. Elles expirent après 30 jours et ne sont jamais présentées comme une nouvelle consultation. Une capture absente, périmée ou invalide laisse la recherche distante prendre le relais.

Le numéro saisi dans la fiche peut fournir un **candidat** depuis une capture ; ce candidat doit encore satisfaire les contrôles de nom, d’adresse et de rattachement au lieu. Le numéro saisi ne filtre pas les autres candidats. Les preuves d’identité conservent la date et l’URL de consultation originales.

```sh
# Réactualise uniquement les identifiants déjà capturés (100 maximum)
node scripts/refresh-official-snapshots.mjs
# Ou une liste explicite d’identifiants SIREN/SIRET
node scripts/refresh-official-snapshots.mjs 78835223500030 200056455
```

Ces fichiers ne sont pas une copie complète du registre. Aucun résultat attendu ni numéro de ligne Grist n’est intégré au résolveur.
