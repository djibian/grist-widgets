# Assistant structures — corpus réel et confiance utilisateur

Base : `main@06951e2596409e82d34854ed258c16d036b19083`. Lecture du document dev2 le 3 novembre 2026 : 25 fiches, sans écriture dans le document. Les tests ne contiennent que les champs publics des structures ; aucune donnée d’élève ou d’enseignant.

## Résultat et limites

La reprise déterministe des réponses publiques donne 23 lieux confirmés et 2 corrections d’adresse à confirmer humainement (Cousteau). Cela ne signifie ni 23 SIRET confirmés, ni 23 GPS précis. Les adresses complétées et contacts publiés peuvent être proposés même lorsqu’aucun numéro propre au lieu n’est établi. Les champs existants ne sont jamais remplacés automatiquement.

| Fiche | Nom proposé | Adresse proposée | Rattachement juridique | Position | Indice |
|---|---|---|---|---|---|
| 1 | Super U Machecoul | ZONE COMMERCIALE BD DES PRISES 44270 MACHECOUL-SAINT-MEME | 41091808000020 | Site corroboré | 85/100 |
| 2 | EHPAD LA REYNERIE | RUE DU PAYS DE RETZ 85230 BOUIN | 26850025300011 | Site démontré | 95/100 |
| 3 | O PRE D'VOUS | 24 RUE DES FOSSES 44270 LA MARNE | 89306104400028 | Site corroboré | 85/100 |
| 4 | Pom'de rainette | 10b, rue Margotins 85300 Sallertaine | 88493583400033 | Site corroboré | 85/100 |
| 5 | Ecole primaire privée de l'Alliance | 55 boulevard Jean XXIII 85300 Challans | 32548690000062 | Site démontré | 95/100 |
| 6 | EHPAD MARIE ET ALBERT GUILLONNEAU | 27 RUE DE LA GAZONNIERE 85300 CHALLANS | 26850050100070 | Site démontré | 95/100 |
| 7 | Ecole primaire privée Sainte Marie | 9 rue de la Paix 44310 Saint-Lumine-de-Coutais | 78605938600023 | Site démontré | 95/100 |
| 8 | Ecole primaire privée Sainte Marie | 9 rue de la Paix 44310 Saint-Lumine-de-Coutais | 78605938600023 | Site démontré | 95/100 |
| 9 | Maison de l'Enfance | 10TER Place du Champ de Foire, 44650 Legé | Non attribué au lieu | Site démontré | 95/100 |
| 10 | Espace et Vie Pornic | 2 rue Joshua Slocum 44210 Pornic | 81237226600021 | Abstention | 75/100 |
| 11 | Retz Accueil | 7 rue Sainte Catherine 44270 Machecoul | Non attribué au lieu | Abstention | 75/100 |
| 12 | Espace et Vie Pornic | 2 rue Joshua Slocum 44210 Pornic | 81237226600021 | Abstention | 75/100 |
| 13 | Espace et Vie Pornic | 2 rue Joshua Slocum 44210 Pornic | 81237226600021 | Abstention | 75/100 |
| 14 | Ecole primaire privée Notre-Dame de Lourdes | 7 rue du Bazouin 44680 Sainte-Pazanne | 78835223500030 | Site démontré | 95/100 |
| 15 | Groupe scolaire Jacques-Yves Cousteau | 1 boulevard Gabriel Reliquet 44270 Machecoul-Saint-Même | À confirmer ; aucune attribution | Abstention | 55/100 |
| 16 | EHPAD LES MIMOSAS | 154 RUE DE LA VIE 85220 COMMEQUIERS | 26850065900027 | Abstention | 75/100 |
| 17 | La Villa des Petits Garnachois | 6 rue des Ciseleurs ZA Voltière Sud 85710 La Garnache | Non attribué au lieu | Abstention | 75/100 |
| 18 | EHPAD RESIDENCE SAINT CHRISTOPHE | 2 RUE DU STADE 85670 ST CHRISTOPHE DU LIGNERON | 26850232500023 | Abstention | 75/100 |
| 19 | Groupe scolaire Jacques-Yves Cousteau | 1 boulevard Gabriel Reliquet 44270 Machecoul-Saint-Même | À confirmer ; aucune attribution | Abstention | 55/100 |
| 20 | Paz à Pas | Rue Françoise Dolto 44680 Sainte-Pazanne | Non attribué au lieu | Abstention | 75/100 |
| 21 | Ecole primaire publique Gaston Chaissac | 4 rue Jules Ferry 44310 La Limouzinière | 21440083000060 | Site démontré | 95/100 |
| 22 | Ecole Notre Dame de la Clarté | 43 rue Félix Platel 44310 Saint-Philbert-de-Grand-Lieu | 78607417900023 | Site démontré | 95/100 |
| 23 | École primaire Notre Dame | 15 rue du Capitaine Debouté 85300 Challans | Non attribué au lieu | Abstention | 75/100 |
| 24 | EHPAD Saint Joseph | Chemin Saint Joseph 44320 Chaumes-en-Retz | Non attribué au lieu | Abstention | 75/100 |
| 25 | Roule Ta Bille | 1 rue Paul Fort 44760 La Bernerie-en-Retz | 79080707700017 | Abstention | 75/100 |

Les trois fiches Espace et Vie sont conservées : aucun rapprochement ni suppression automatique de doublons dans Grist. La fiche Sainte Marie au mauvais numéro propose le SIRET du site, décoché ; la fiche déjà corrigée reste cohérente.

## Constats discriminants

- Cousteau : l’adresse saisie correspond à l’adresse de la mairie. La mairie publie le groupe scolaire à une autre adresse, avec deux accès distincts (maternelle / primaire). Le courriel RH municipal sert uniquement à suggérer la commune ; il ne prouve pas une école. La correction vers le groupe scolaire reste probable, sans GPS ni numéro juridique, avec tous les remplacements décochés. L’utilisateur doit confirmer l’implantation avant de relancer. Source : https://www.machecoul-saint-meme.fr/vivre-ici/enfance-jeunesse/les-etablissements-scolaires/
- Notre-Dame de Challans : le SIRET présent dans l’export Éducation (`78644886000027`) renvoie à l’UDOGEC à La Roche-sur-Yon. L’UAI ne permet pas d’attribuer l’adresse de ce siège à l’école. Le site de l’école confirme le lieu au 15 rue du Capitaine Debouté ; aucun SIRET de gestionnaire n’est proposé pour ce lieu. Source : https://challans-ecolenotredame.fr/
- Saint-Joseph : le même SIRET/FINESS est publié avec `Chemin Saint Joseph` dans FINESS et `4 route de Pornic` dans l’Annuaire. Le lien par identifiant ne démontre pas à lui seul une équivalence d’accès ou de bâtiment. Le lieu et son adresse usuelle restent proposés depuis le site de l’établissement ; la contradiction juridique est conservée. Source : https://ehpad-saint-joseph.net/
- La Garnache : la collectivité publie `6 rue des Ciseleurs, ZA Voltière Sud, 85710 La Garnache` et le téléphone fourni ; l’opérateur publie la même voie sans numéro. Un annuaire tiers affiche 11 avec un autre téléphone : ce dernier n’est pas retenu. Aucun point de voie ne devient un GPS de bâtiment. Sources : https://petiteenfance.challansgois.fr/trouver-un-accueil/ et https://www.lpcr.fr/creches/la-garnache/12604/
- Les Mimosas : le numéro saisi `26850065400027` diffère du SIRET géographique revalidé `26850065900027`. Le nom et le numéro/voie permettent la découverte sans commune et sans utiliser ce numéro saisi comme veto.
- Notre-Dame de la Clarté : le contact publié est `ecolenddlc@gmail.com`, téléphone `02 40 78 70 18`, à Saint-Philbert-de-Grand-Lieu. L’adresse, le téléphone et le courriel saisis contiennent des omissions/erreurs ; les corrections restent à accepter explicitement. Source : https://notredamedelaclarte.fr/contacts/

## Architecture

Le localisateur est généré depuis la totalité des 4 837 entrées régionales déjà indexées (Éducation et FINESS). Il contient les noms, adresses, identifiants, pointeurs vers les extraits natifs et contacts publiés disponibles. Les contacts issus d’un export plus récent ne sont conservés que si UAI, SIRET, état ouvert et adresse demeurent compatibles. Il permet la découverte sans commune, sans télécharger chaque extrait natif. Le runtime relit ensuite les extraits natifs sélectionnés et conserve la revalidation Annuaire pour le SIRET du site.

Les noms approximatifs nécessitent des termes distinctifs (deux au minimum, au plus une faute de caractère), et une adresse ou un contact de site concordants. Numéro, suffixe, code postal et commune contradictoires bloquent le rapprochement. Un domaine de courriel commun n’est jamais une preuve positive. Les homonymes restent des alternatives, sans départage par proximité.

Un adaptateur de lieux publiés complète ce dispositif : une cohorte de 16 accueils est extraite automatiquement de l’annuaire de la collectivité ; quelques fiches d’opérateurs et d’annuaires institutionnels sont conservées comme données revues, avec URL, date, empreinte de capture et extraits natifs. Elles ne constituent pas une couverture nationale automatique. Les règles de rapprochement ne contiennent aucun nom des établissements du corpus. Ajouter un secteur ou un format de publication nécessitera éventuellement un adaptateur ou une donnée revue, et pas une exception dans le résolveur.

La confirmation d’un lieu est distincte de sa confirmation juridique. Nom/adresse attestés peuvent produire un candidat sans SIRET. Le candidat conserve ses preuves et ses contacts, et ne reçoit aucune coordonnée finale lorsque seule une cible d’itinéraire ou une adresse géocodée est disponible. Les cibles OSM publiées dans les annuaires CAF/Département sont classées `address-target`, pas promues en points de bâtiment ou de site. Les identités/positions historiques démontrées restent traitées par leurs sources existantes.

Les budgets et l’annulation sont conservés : découverte de référentiel 1,8 s, annuaire de lieux 1,5 s, identité 12 s, sources de position 10 s, repli OSM 1,5 s, garde UI 24 s. Les erreurs de sources ne changent pas une preuve positive déjà reçue. Le résultat réseau peut rester incomplet quand une revalidation nécessaire est indisponible ; les tests de reprise ne promettent pas une disponibilité permanente des API.

## Présentation et écritures

L’utilisateur voit le nom, l’adresse, les coordonnées seulement lorsqu’elles sont démontrées, et un indice coloré avec un libellé. Les services, versions, identifiants sectoriels et traces sont repliés dans les détails. Le numéro saisi sert à corroborer ; il ne réfute pas un lieu établi par son nom et son adresse.

L’indice est ordinal, **pas une probabilité de réussite** : 95 site confirmé, 85 site corroboré, 75 lieu confirmé sans position, 55 proposition à confirmer, 40 contradiction de position, 35 ambiguïté, 25 vérification incomplète, 0 absence d’information. Une contradiction ne peut pas être compensée par plusieurs contacts concordants.

Les contrôles de sélection, de génération et la relecture du contenu Grist sont conservés. Les coordonnées sont toujours atomiques avec leurs preuves ; elles ne peuvent pas être mélangées à un autre SIRET. Les propositions de nom/adresse/contact n’inventent ni numéro juridique ni contact. Un lieu sans numéro établi ne reçoit aucun numéro de mairie, d’association gestionnaire ou de siège. Les alias de colonnes physiques (`Site_web` notamment) permettent la lecture des champs disponibles sans nouvelle configuration ambiguë.

## Reproduction

```sh
npm test
node scripts/capture-structure-context-live.mjs
# Registre complet et localisateur ; aucun nom d’établissement ciblé :
node scripts/generate-site-registry.mjs
# Cohorte d’accueil publiée par la collectivité :
node scripts/generate-childcare-directory.mjs
# Vérification des faits revus ; échoue si une valeur/point a disparu :
node scripts/refresh-named-site-directory.mjs
```

Le corpus d’entrée est `tests/fixtures/context/input-rows.json` et les enveloppes HTTP publiques capturées sont dans `tests/fixtures/context/official-responses.json`. Le test `site-context-resolution.test.mjs` reprend les 25 fiches, les variantes, les erreurs d’identifiant et les négatifs ; `establishment-enrichment-ui.test.mjs` exécute également les 25 fiches par le listener réellement chargé par Grist, puis applique des corrections sous contrôle. La capture réseau complète est distincte de cette reprise : ses latences et indisponibilités sont des observations, pas des résultats remplacés par les données de test.
