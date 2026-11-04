# Archive — Contacts publics (étapes 03–04)

L'implémentation expérimentale est préservée intégralement, sans aucune réécriture, sur la branche Git `archive/structure-picker-contacts-experiment-20261104`, commit d'origine `8a3744e8aa553ee6ed97bee5e0a1901f2b0d0db7`.

L'archive contient le contrôleur `contacts-experiment.js`, `contact-search.js`, `contact-model.js`, `contact-ranking.js`, `contact-presentation.js`, `contact-sources/` (OSM, DILA, Wikidata, All The Places, Overture), les tests, la feuille de style et la documentation `CONTACTS-EXPERIMENT.md`.

**Le parcours actif 01–02 reste inchangé** : code d'identité, position, propositions, interfaces et mécanismes d'écriture. Le composant `contact-indexes.js`, les index ATP/Overture et leur publication sont partagés avec la géolocalisation active et sont donc conservés.

Pour une réutilisation future, relire les critères de fiabilité du module expérimental : une proximité géographique ou un SIRET saisi ne suffisent pas à établir l'identité d'un lieu. Ne pas réintroduire de second bouton d'écriture sans validation des preuves et du contexte Grist.

Vérifications attendues : absence des étapes 03–04, présence des deux étapes 01–02, suite `npm test` réussie et diff ne touchant aucun moteur actif.
