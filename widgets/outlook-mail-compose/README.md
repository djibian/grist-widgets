# Préparer un courriel Outlook

Widget Grist minimal pour ouvrir Outlook Web avec un message prérempli à partir de la ligne sélectionnée.

## Principe

Le widget ne fait aucun envoi lui-même et n'utilise ni API Microsoft, ni secret, ni serveur intermédiaire.

Il construit localement dans le navigateur une URL de composition Outlook Web :

`https://outlook.office.com/mail/deeplink/compose`

puis ouvre Outlook avec :

- le destinataire ;
- l'objet ;
- le corps du message.

L'utilisateur vérifie ensuite le message et clique lui-même sur **Envoyer** dans Outlook.

## Colonnes à associer

- **Destinataire** — adresse de courriel ;
- **Objet** — objet du message ;
- **Corps** — corps texte du message ;
- **Libellé de la ligne** — facultatif, uniquement pour l'affichage dans le widget.

Le widget demande seulement l'accès `read table`.

## Limites assumées

- le corps transmis au compositeur Outlook Web est du texte simple, pas du HTML ;
- les URL complètes peuvent être incluses telles quelles dans le texte, mais leur rendu cliquable dépend d'Outlook et du client du destinataire ;
- aucune information fiable de type « envoyé » ne peut être remontée automatiquement dans Grist, puisque l'envoi est confirmé ensuite dans Outlook ;
- les pièces jointes ne sont pas prises en charge ;
- le mécanisme repose sur une URL de composition : il convient donc aux messages de taille raisonnable, pas à de très longs contenus ;
- l'utilisateur doit être authentifié dans Outlook Web dans son navigateur.

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
