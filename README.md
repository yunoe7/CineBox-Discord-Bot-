# CinéBox Discord Bot

Bot Discord du club CinéBox. Le projet combine une API d'interactions Discord et un service Gateway persistant.

## Architecture

- **API HTTP** : reçoit les commandes slash et les clics sur les composants via `/api/discord`.
- **Gateway Railway** : gère les événements de membres et les protections déclenchées par les messages (anti-spam et anti-raid).
- **Stockage des sondages** : les votes sont conservés dans un fichier JSON sur le volume Railway monté sur `/data`. Pour que ce stockage soit utilisé, Discord doit envoyer les interactions au serveur Railway (et non à la fonction Vercel).

Les deux services sont complémentaires : l'API gère les interactions, tandis que le Gateway écoute les événements temps réel du serveur.

## Variables d'environnement

### API d'interactions

- `DISCORD_PUBLIC_KEY` : clé publique de l'application Discord.
- `DISCORD_TOKEN` : token du bot, à conserver uniquement comme secret.
- `CLIENT_ID` : identifiant de l'application Discord.
- `GUILD_ID` : identifiant du serveur pour l'enregistrement des commandes.
- `REPORT_CHANNEL_ID` : salon de signalement (facultatif).
- `SUGGESTION_CHANNEL_ID` : salon de suggestions (facultatif).
- `CINEMA_POLL_STORE` : chemin du fichier de votes (facultatif, défaut `/data/cinema-polls.json`).

### Gateway Railway

- `DISCORD_TOKEN` : token du bot.
- `WELCOME_CHANNEL_ID` : salon de bienvenue (facultatif).
- `GOODBYE_CHANNEL_ID` : salon de départ (facultatif, utilise le salon de bienvenue par défaut).
- `NEW_MEMBER_ROLE_ID` : rôle à attribuer à l'arrivée (facultatif).
- `INTRO_CHANNEL_ID` et `RULES_CHANNEL_ID` : salons à mentionner dans le message de bienvenue (facultatifs).

Ne jamais publier de token dans GitHub ou dans une conversation. Si un token est exposé, le réinitialiser dans le Developer Portal Discord puis mettre à jour les secrets des services concernés.

## Commandes

### Cinéma
- `/sondage-cinema` : publie un vote avec 2 à 4 films. Un membre ne peut voter qu'une fois par sondage ; les votes sont sauvegardés sur le volume Railway.
- `/cloturer-sondage` : ferme le sondage le plus récent du salon et publie le classement final.
- `/tirage-cinema` : tire au sort un film parmi 2 à 4 propositions.
- `/recommandation-cinema` : recommande un film selon le genre et l'ambiance.
- `/quiz-cinema` : lance une question de culture cinéma interactive.
- `/programmer-seance` : crée un événement Discord lié à un salon vocal, à une date et une heure Europe/Paris.

### Communauté
- `/signaler` : transmet un problème à l'équipe.
- `/suggestion` : transmet une idée à l'équipe.
- `/help` : affiche le guide des commandes.
- `/ping` : vérifie que l'API répond et affiche les métriques de son propre processus.

### Modération et administration
- `/warn`, `/warnings`, `/clear-warnings` : gère les avertissements.
- `/timeout`, `/untimeout`, `/kick`, `/ban` : actions de modération soumises aux permissions Discord et à la hiérarchie des rôles.
- `/modlogs` : consulte les dernières actions consignées dans le salon de logs.
- `/setup` : installe ou répare les rôles, catégories et salons (administrateurs).
- `/config-accueil` : configure les notifications d'arrivée et de départ.
- `/reset-cinebox` : retire la structure CinéBox après confirmation (administrateurs).

## Déploiement

### API

Le service Railway exécute à la fois le Gateway Discord et le serveur HTTP d'interactions. Les commandes sont enregistrées avec `npm run register` au démarrage. Les variables `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `CLIENT_ID` et éventuellement `GUILD_ID` doivent être configurées sur Railway.

Dans le Developer Portal Discord, règle **Interactions Endpoint URL** sur l'URL Railway suivante :

```
https://cinebox-discord-bot-production.up.railway.app/interactions
```

Cette URL est importante : elle dirige les clics de vote vers le même service Railway que celui qui possède le volume `/data`. L'endpoint Vercel `/api/discord` ne doit pas être utilisé pour les interactions tant que le stockage des votes repose sur ce volume.

### Gateway

Créer un service Railway depuis ce dépôt et utiliser :

```bash
npm run start:gateway
```

Ajouter `DISCORD_TOKEN` et les identifiants de salons/rôle nécessaires. Activer l'intent privilégié **Server Members Intent** dans le Developer Portal Discord. Le bot doit avoir les permissions nécessaires pour consulter les salons, envoyer des messages et attribuer le rôle d'accueil ; son rôle doit être placé au-dessus du rôle attribué automatiquement.

### Stockage des votes

Le serveur d'interactions Railway et le fichier de votes partagent le même service et le même volume persistant monté dans `/data`. Le chemin peut être personnalisé avec `CINEMA_POLL_STORE`. Vercel ne partage pas ce volume : ne configure pas l'endpoint Discord vers Vercel sans migrer auparavant les votes vers une base accessible depuis Vercel.

## Limites à connaître

- Les compteurs et classements des sondages sont reconstruits depuis les votes persistés ; les anciens sondages créés avant l'activation de la persistance ne disposent pas de données de vote récupérables.
- `/ping` mesure le processus API qui traite la commande ; il ne mesure pas directement l'uptime ni la latence du Gateway Railway.
- Les recommandations utilisent un catalogue de films intégré au code et non une base externe.
- Les événements de messages et de membres nécessitent que le service Gateway Railway soit démarré et connecté.
