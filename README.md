# Movix Discord Bot

Bot officiel de la communauté **Movix**. Il relie le serveur Discord au site Movix tout en conservant les outils communautaires : modération, sondages, quiz, recommandations et événements cinéma.

## Architecture

- **API d'interactions** : reçoit les commandes slash et les clics sur les boutons via `/interactions`.
- **Gateway Railway** : écoute les arrivées/départs, applique l'anti-spam et l'anti-raid, synchronise les rôles VIP et publie les journaux.
- **Votes** : conservés dans `/data/cinema-polls.json` sur le volume persistant Railway.

Le Gateway et l'API HTTP doivent utiliser le même service Railway si les interactions de vote doivent partager le stockage `/data`.

## Variables Railway

### Communes / Discord
- `DISCORD_TOKEN` : token privé du bot.
- `CLIENT_ID` : identifiant de l'application Discord.
- `DISCORD_PUBLIC_KEY` : clé publique utilisée pour vérifier les signatures des interactions.
- `GUILD_ID` : facultatif, pour enregistrer les commandes sur un seul serveur pendant les tests.

### Intégration Movix
- `MOVIX_SITE_URL` : URL publique du site (défaut : `https://movix.miami`).
- `MOVIX_API_URL` : URL de l'API principale (défaut : `https://main-api-production-1590f478.up.railway.app`).
- `MOVIX_DISCORD_SYNC_SECRET` : secret partagé avec l'API Movix pour vérifier les comptes et synchroniser les rôles VIP.
- `VIP_ROLE_ID` : identifiant du rôle Discord attribué aux comptes VIP actifs.
- `WELCOME_CONFIG_CHANNEL_ID` : facultatif, identifiant du salon privé où la configuration des arrivées/départs est stockée.

Le même secret doit être configuré dans le service **Main API Movix** sous `MOVIX_DISCORD_SYNC_SECRET`. Pendant la transition, le bot accepte aussi l'ancien nom `CINEBOX_API_SECRET`, mais il est recommandé de migrer vers le nom Movix. Ne jamais publier ce secret.

### Autres options
- `REPORT_CHANNEL_ID` : salon de signalement (facultatif).
- `SUGGESTION_CHANNEL_ID` : salon de suggestions (facultatif).
- `CINEMA_POLL_STORE` : chemin du stockage des votes (défaut : `/data/cinema-polls.json`).
- `WELCOME_CHANNEL_ID`, `GOODBYE_CHANNEL_ID`, `NEW_MEMBER_ROLE_ID` : options facultatives historiques ; la configuration interactive est gérée par `/config-accueil`.

## Commandes

### Compte Movix
- `/mon-compte` : vérifie la liaison Discord et affiche le profil lié.
- `/vip` : consulte le statut VIP et sa validité.
- Le Gateway vérifie périodiquement les statuts VIP et ajuste le rôle configuré.

### Communauté cinéma
- `/sondage-cinema` et `/cloturer-sondage` : votes communautaires persistés.
- `/tirage-cinema` : tirage au sort d'un film.
- `/recommandation-cinema` : suggestion selon le genre et l'ambiance.
- `/quiz-cinema` : quiz interactif.
- `/programmer-seance` : événement Discord planifié.

### Assistance et modération
- `/signaler`, `/suggestion`, `/help`, `/ping`.
- `/warn`, `/warnings`, `/clear-warnings`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/modlogs`.
- `/setup` : installe ou répare la structure Movix.
- `/config-accueil` : configure les messages d'arrivée/départ et le rôle automatique.
- `/reset-movix` : commande de remise à zéro historique, à utiliser avec une extrême prudence.

## Déploiement

1. Installer les dépendances : `npm ci`.
2. Vérifier la syntaxe : `npm run check`.
3. Enregistrer les commandes : `npm run register`.
4. Démarrer le service : `npm start` (ou `npm run start:gateway` si le démarrage doit enregistrer les commandes avant le Gateway).
5. Dans le portail développeur Discord, définir l'URL d'interactions sur l'URL publique Railway suivie de `/interactions`.
6. Monter un volume Railway sur `/data` pour conserver les votes après redémarrage.

Activer l'intent privilégié **Server Members Intent** dans le portail Discord. Le bot doit disposer des permissions adaptées pour lire les salons, envoyer des messages, gérer les messages, gérer les membres selon les commandes, créer des événements et attribuer le rôle VIP. Le rôle du bot doit être placé au-dessus du rôle VIP et du rôle automatique.

## Migration depuis CinéBox

Le code accepte encore l'ancien secret `CINEBOX_API_SECRET` et les anciens marqueurs de configuration d'accueil/avertissements afin de ne pas perdre les réglages et journaux existants. La commande de configuration crée désormais les marqueurs Movix. Le setup renomme le rôle VIP et les salons historiques reconnus au lieu de créer un doublon.

**Important :** ne lance pas `/setup` ou `/reset-movix` en production sans vérifier au préalable la structure et les permissions du serveur. Le setup peut créer/renommer des rôles et salons. La commande reset est destructive.

## Sécurité

Ne jamais committer de token Discord ni de secret d'intégration. Si un token est exposé, le révoquer dans le portail développeur Discord et remplacer le secret Railway correspondant.
