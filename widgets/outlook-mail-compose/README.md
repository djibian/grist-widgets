# Préparer un courriel Outlook

Widget Grist minimal pour ouvrir Outlook Web avec un message prérempli à partir de la ligne sélectionnée.

## Principe

Le widget ne fait aucun envoi lui-même et n'utilise ni API Microsoft, ni secret, ni serveur intermédiaire.

Il ouvre le compositeur Outlook Web de Microsoft 365 avec :

- le destinataire issu d'une colonne Grist ;
- l'objet défini directement dans les réglages du widget ;
- le corps défini directement dans les réglages du widget.

L'utilisateur vérifie ensuite le message et clique lui-même sur **Envoyer** dans Outlook.

## Colonnes à associer

- **Destinataire** — adresse de courriel ;
- **Libellé de la ligne** — facultatif, uniquement pour l'affichage dans le widget.

Il n'est pas nécessaire de créer de colonne Grist pour l'objet ou le corps.

Le widget demande seulement l'accès `read table`.

## Modèle du message

L'objet et le corps sont enregistrés comme options du widget. Ils peuvent contenir des variables correspondant aux identifiants de colonnes de la ligne sélectionnée :

```text
Bonjour {{Prenom}},

Voici votre lien : {{Lien_Stages}}

Cordialement
```

Le widget affiche les variables disponibles pour la ligne sélectionnée. Une variable inconnue bloque l'ouverture d'Outlook afin d'éviter d'envoyer un message incomplet.

Après **Appliquer les réglages**, Grist considère les options du widget comme modifiées : utilisez également l'action **Enregistrer** de Grist pour les rendre persistantes après rechargement.

## Ouverture d'Outlook

Le widget utilise la route Microsoft 365 destinée aux comptes professionnels :

`https://outlook.office.com/?path=/mail/action/compose`

L'ouverture est déclenchée directement par le clic utilisateur afin d'éviter le blocage des fenêtres surgissantes. Le destinataire, l'objet et le corps sont encodés dans l'URL.

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
