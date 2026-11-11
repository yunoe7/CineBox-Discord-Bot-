# CinéBox Discord Bot

Bot Discord CinéBox, avec une version serverless basée sur les interactions HTTP de Discord pour un déploiement sur Vercel.

## Architecture Vercel

Discord envoie les commandes slash à `/api/discord`. Cette architecture ne maintient pas de connexion Gateway et ne lit donc pas les messages ordinaires du serveur.

## Variables d’environnement Vercel

Configurer ces variables dans **Project → Settings → Environment Variables** :

- `DISCORD_PUBLIC_KEY` : clé publique de l’application Discord (Developer Portal → General Information).
- `DISCORD_TOKEN` : token du bot, à ajouter comme secret Vercel uniquement.
- `CLIENT_ID` : identifiant de l’application Discord.
- `GUILD_ID` : identifiant du serveur pour enregistrer les commandes sur ce serveur.
- `REPORT_CHANNEL_ID` : identifiant du salon de signalement.
- `SUGGESTION_CHANNEL_ID` : identifiant du salon de suggestions.

Ne jamais publier de token dans GitHub, dans un fichier .env commité, ni dans une conversation. Si un token a été exposé, le réinitialiser dans le Developer Portal avant le déploiement.

## Déploiement

1. Importer ce dépôt GitHub dans Vercel.
2. Ajouter les variables d’environnement ci-dessus.
3. Déployer le projet.
4. Dans Discord Developer Portal → General Information, définir **Interactions Endpoint URL** sur `https://TON-DOMAINE-VERCEL/api/discord`.
5. Discord enverra un PING pour vérifier l’endpoint.
6. Enregistrer les commandes slash avec `npm run register` depuis un environnement local configuré avec les variables `DISCORD_TOKEN`, `CLIENT_ID` et `GUILD_ID`.

## Commandes

- `/ping` : vérifie que l’endpoint répond.
- `/help` : affiche l’aide.
- `/signaler` : transmet un signalement au salon configuré.
- `/suggestion` : transmet une suggestion au salon configuré.
- `/setup` : présent dans la liste des commandes, mais sa migration complète vers l’API HTTP reste à faire.

## Important

La version HTTP ne reçoit pas les messages ordinaires, les réactions ni les événements Gateway. La commande `/setup` qui crée les rôles et salons doit être migrée vers des appels REST avant d’être utilisée. Le bot ne doit pas être considéré comme entièrement opérationnel tant que cette migration n’est pas terminée et testée.
