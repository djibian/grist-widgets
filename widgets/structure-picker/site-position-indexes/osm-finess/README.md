# Points de site OSM avec FINESS

Extraction complète du 2 octobre 2026 à 21:57:01 UTC, OpenStreetMap / Overpass API, licence ODbL 1.0. Requête départementale sans filtre de nom, de commune ou de SIRET :

```overpass
[out:json][timeout:60];nwr["ref:FR:FINESS"~"^(44|85)"];out meta center;
```

Le générateur conserve les points typés comme lieux, leur FINESS, leurs tags originaux et les métadonnées de l’objet. Les voies, localités, objets désaffectés et centres de géométries non ponctuelles sont exclus de cet index. Les 814 points sont répartis en 79 fichiers par préfixe FINESS ; chaque fichier reste inférieur à 96 KiB. Les références ne sont pas rectifiées ni complétées par proximité. Un identifiant contradictoire reste visible pour provoquer l’abstention du résolveur.

Régénération depuis la source publique actuelle :

```sh
python3 scripts/generate-osm-finess-positions.py --departments 44,85
```

Une réponse Overpass partielle (`remark`), une extraction sans date ou un fichier dépassant le budget bloque la publication. `--input fichier.json` permet de rejouer une réponse complète capturée, sans modifier ses objets.

Le navigateur consulte au maximum deux FINESS géographiques après confirmation de l’identité. Le FINESS actif doit être relié au SIRET par le registre ANS et par une réponse Annuaire actuelle. Un nom abrégé n’est admis qu’avec ce FINESS exact, la même catégorie FINESS et un type de lieu concordant. Les rues et coordonnées administratives restent des éléments de découverte. Les identifiants, noms, types, adresses ou positions démontrées contradictoires entraînent l’abstention ; aucune distance ne sert à rattacher un POI à un SIRET.

La date d’extraction OSM, la version/date de chaque objet et ses tags `source` décrivent des faits distincts : l’extraction actuelle ne signifie pas que la géométrie a été récemment relevée. Cette preuve situe le point public de l’établissement ; elle ne constitue pas un relevé topographique ni une preuve de position de l’entrée.
