# Emprises scolaires IGN

Génération générique d’une cohorte communale complète de la couche BD TOPO `zone_d_activite_ou_d_interet` :

```sh
node scripts/generate-ign-site-positions.mjs --commune 85047
```

Le code INSEE définit une zone de couverture, aucun établissement cible. Le nombre retourné doit égaler `numberMatched` ; une réponse tronquée est refusée. Les objets possédant une géométrie exploitable et un identifiant `MEN:<UAI>` sont conservés sans sélectionner leurs noms. Les fichiers `<commune>/<préfixe-UAI>.json` sont bornés à 96 Kio ; la génération retire les anciens préfixes absents du nouvel instantané pour cette seule commune. La preuve conserve les attributs et la géométrie IGN natifs, l’URL de requête, la date de capture et la Licence Ouverte 2.0.

La lecture dans Grist exige un UAI lié au SIRET géographique par Éducation et Annuaire, un nom/type/adresse/commune cohérents, une emprise non fictive en service, issue d’orthophotographie et un point strictement intérieur. Les géométries partagées par plusieurs UAI et les contradictions sont refusées. Les limites polygonales et le point représentatif ne prétendent pas identifier l’entrée d’un bâtiment. `boundaryPrecisionMeters` décrit la frontière, pas la précision absolue du point calculé.

Instantané initial : commune 85047, capture 2026-10-27, 124 objets examinés, 21 objets UAI distincts dans 18 fichiers (22 occurrences, un objet multipréfixe). L’extension géographique reste une opération explicite de génération de données ; aucun WFS ne bloque le navigateur.
