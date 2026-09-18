# Préparer un courriel Outlook

Widget Grist minimal pour préparer un courriel depuis la ligne sélectionnée puis l'ouvrir dans Outlook Web.

## Principe

Le widget ne fait aucun envoi lui-même et n'utilise ni API Microsoft, ni secret, ni serveur intermédiaire.

L'interface est volontairement organisée en deux étapes :

1. **Vérifier** — afficher le courriel complet avec destinataire, objet et corps déjà résolus ;
2. **Ouvrir** — ouvrir Outlook Web avec ce même message prérempli, puis laisser l'utilisateur cliquer sur **Envoyer**.

## Champs à associer

Deux mappings sont obligatoires :

- **Destinataire** — adresse de courriel ;
- **Lien** — lien personnel à insérer dans le message.

Il n'est pas nécessaire de créer de colonne Grist pour l'objet ou le corps.

Le widget demande seulement l'accès `read table`.

## Variables du modèle

Le modèle n'accède pas directement à toutes les colonnes de la ligne Grist. Une donnée utilisable dans le modèle doit correspondre à un mapping explicite du widget.

La version actuelle expose seulement :

- `{{Destinataire}}` — valeur de la colonne mappée sur **Destinataire** ;
- `{{Lien}}` — valeur de la colonne mappée sur **Lien**.

Cela évite les doublons ambigus du type `{{Destinataire}}` / `{{Email}}` ou `{{Lien}}` / `{{Lien_Stages}}`. Si un nouveau champ doit être utilisé plus tard dans le modèle, il devra d'abord être ajouté comme mapping explicite au widget.

Si la colonne **Lien** est un hyperlien produit par `SELF_HYPERLINK`, sa valeur peut être exposée au widget sous la forme `Libellé https://...`. Le widget extrait uniquement l'URL pour `{{Lien}}` ; le libellé d'origine n'est pas repris dans le courriel.

## Modèle du message

Le widget fournit désormais ce modèle par défaut :

```text
Objet : Votre lien personnel pour le suivi des stages

Bonjour,

Voici votre lien personnel pour le suivi des stages :
{{Lien}}

Ce lien est personnel. Merci de ne pas le transmettre ni de le diffuser.

Cordialement
```

L'objet et le corps peuvent être modifiés dans **Modifier le modèle pour les prochains messages**. La prévisualisation est mise à jour immédiatement.

Une variable non mappée bloque l'ouverture d'Outlook afin d'éviter de préparer un message incomplet.

Après **Appliquer ce modèle**, Grist considère les options du widget comme modifiées : utilisez également l'action **Enregistrer** de Grist pour les rendre persistantes après rechargement.

Les anciens modèles par défaut connus sont migrés automatiquement vers le nouveau texte. Un modèle réellement personnalisé par l'utilisateur est conservé.

## Ouverture d'Outlook

Le bouton **Ouvrir dans Outlook** est un lien HTML direct (`target="_blank"`) plutôt qu'un appel JavaScript à `window.open()`. L'ouverture reste ainsi directement attachée au clic utilisateur et n'est pas traitée comme une fenêtre surgissante créée par script.

La route utilisée est le deeplink Outlook Web de composition pour Microsoft 365 :

`https://outlook.office.com/mail/0/deeplink/compose`

Le widget ajoute `popoutv2=1`, puis encode le destinataire, l'objet et le corps dans les paramètres `to`, `subject` et `body`.

La précédente route historique `/?path=/mail/action/compose` a été abandonnée après test réel : elle ouvrait bien Outlook mais sans ouvrir le message préparé dans l'environnement testé.

## Limites assumées

- le paramètre `body` du deeplink Outlook Web est du texte simple : il n'est pas possible d'y transmettre un vrai lien HTML masqué derrière un libellé ;
- la solution minimale transmet donc l'URL complète, qu'Outlook peut détecter comme lien cliquable selon son mode de composition ;
- aucune information fiable de type « envoyé » ne peut être remontée automatiquement dans Grist, puisque l'envoi est confirmé ensuite dans Outlook ;
- les pièces jointes ne sont pas prises en charge ;
- le mécanisme repose sur une URL de composition : il convient donc aux messages de taille raisonnable ;
- l'utilisateur doit être authentifié dans Outlook Web dans son navigateur. Une réauthentification Microsoft peut modifier ou perdre les paramètres du deeplink ; ce cas devra être testé séparément.

Obtenir un lien masqué derrière un libellé nécessiterait de créer un brouillon HTML par une API Microsoft (par exemple Microsoft Graph) ou d'utiliser une extension Outlook, ce qui sort volontairement de l'architecture minimale de ce widget.

## Sécurité et données

Aucune donnée du message n'est transmise par le widget tant que l'utilisateur ne clique pas sur **Ouvrir dans Outlook**. Au clic, le navigateur ouvre directement `outlook.office.com` avec le destinataire, l'objet et le corps encodés dans l'URL de composition.

Il n'y a donc :

- aucun webhook ;
- aucune clé API Grist ;
- aucun jeton Microsoft ;
- aucun mot de passe ;
- aucun service applicatif à héberger.

## URL publiée

`https://djibian.github.io/grist-widgets/widgets/outlook-mail-compose/`

## Tests

`npm run test:outlook-mail-compose`
