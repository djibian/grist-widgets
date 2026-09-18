# Préparer un courriel Outlook

Widget Grist minimal pour préparer un courriel depuis la ligne sélectionnée puis l'ouvrir dans Outlook Web.

## Principe

Le widget ne fait aucun envoi lui-même et n'utilise ni API Microsoft, ni secret, ni serveur intermédiaire.

L'interface est volontairement organisée en deux étapes :

1. **Vérifier** — afficher le courriel complet avec destinataire, objet et corps déjà résolus ;
2. **Ouvrir** — ouvrir Outlook Web avec ce même message prérempli, puis laisser l'utilisateur cliquer sur **Envoyer**.

## Colonnes à associer

- **Destinataire** — adresse de courriel ;
- **Lien** — lien personnalisé à insérer dans le message.

Il n'est pas nécessaire de créer de colonne Grist pour l'objet ou le corps.

Le widget demande seulement l'accès `read table`.

## Modèle du message

Le widget fournit un modèle par défaut immédiatement utilisable :

```text
Objet : Votre lien d'accès

Bonjour,

Voici votre lien d'accès :
{{Lien}}

Cordialement
```

`{{Lien}}` désigne toujours la colonne associée au mapping **Lien**, quel que soit son nom réel dans le document Grist.

L'objet et le corps peuvent être modifiés dans **Modifier le modèle pour les prochains messages**. La prévisualisation est mise à jour immédiatement. D'autres colonnes de la ligne peuvent également être utilisées avec la syntaxe `{{Nom_de_colonne}}`.

Une variable inconnue bloque l'ouverture d'Outlook afin d'éviter de préparer un message incomplet.

Après **Appliquer ce modèle**, Grist considère les options du widget comme modifiées : utilisez également l'action **Enregistrer** de Grist pour les rendre persistantes après rechargement.

## Ouverture d'Outlook

Le widget construit une URL de composition Microsoft 365 à partir du destinataire, de l'objet et du corps résolus.

Le bouton **Ouvrir dans Outlook** est un lien HTML direct (`target="_blank"`) plutôt qu'un appel JavaScript à `window.open()`. L'ouverture reste ainsi directement attachée au clic utilisateur et ne doit pas être traitée comme une fenêtre surgissante créée par script.

La route actuellement testée est :

`https://outlook.office.com/?path=/mail/action/compose`

Le destinataire, l'objet et le corps sont encodés dans l'URL.

## Limites assumées

- le corps transmis au compositeur Outlook Web est du texte simple, pas du HTML ;
- les URL complètes peuvent être incluses telles quelles dans le texte, mais leur rendu cliquable dépend d'Outlook et du client du destinataire ;
- aucune information fiable de type « envoyé » ne peut être remontée automatiquement dans Grist, puisque l'envoi est confirmé ensuite dans Outlook ;
- les pièces jointes ne sont pas prises en charge ;
- le mécanisme repose sur une URL de composition : il convient donc aux messages de taille raisonnable ;
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
