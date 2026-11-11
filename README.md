# CinéBox Discord Bot

Bot du serveur CinéBox, déployé en interactions HTTP Discord sur Vercel.

## Architecture

Discord envoie les commandes slash et les clics sur composants à `/api/discord`. Cette version fonctionne sans connexion Gateway persistante. Elle ne reçoit donc pas les messages ordinaires du serveur ni les événements de présence.

## Variables d’environnement Vercel

- `DISCORD_PUBLIC_KEY` : clé publique de l’application Discord.
- `DISCORD_TOKEN` : token du bot, à conserver uniquement comme secret Vercel.
- `CLIENT_ID` : identifiant de l’application Discord.
- `GUILD_ID` : identifiant du serveur pour l’enregistrement des commandes.
- `REPORT_CHANNEL_ID` : salon de signalement (facultatif si le salon créé par `/setup` est utilisé).
- `SUGGESTION_CHANNEL_ID` : salon de suggestions (facultatif si le salon créé par `/setup` est utilisé).

Ne jamais publier de token dans GitHub ou dans une conversation. Si un token a été exposé, le réinitialiser dans le Developer Portal puis mettre à jour Vercel.

## Commandes

### Cinéma
- `/sondage-cinema` : publie un vote avec 2 à 4 films et des boutons.
- `/tirage-cinema` : tire au sort un film parmi 2 à 4 propositions.
- `/recommandation-cinema` : recommande un film selon le genre et l’ambiance.
- `/quiz-cinema` : lance une question de culture cinéma avec quatre réponses interactives.
- `/programmer-seance` : crée un événement Discord lié à un salon vocal, avec date et heure locales Europe/Paris. Nécessite la permission Gérer les événements.

### Communauté et administration
- `/help` : guide des commandes.
- `/ping` : vérifie que l’endpoint répond.
- `/signaler` : transmet un signalement.
- `/suggestion` : transmet une idée à l’équipe.
- `/setup` : installe ou répare les rôles, catégories et salons (administrateurs).

## Déploiement et enregistrement des commandes

Le projet est relié à Vercel et les commandes sont enregistrées pendant le build via `npm run register`. Les variables `DISCORD_TOKEN`, `CLIENT_ID` et `GUILD_ID` doivent être disponibles pour le build.

L’endpoint d’interactions Discord doit pointer vers `https://TON-DOMAINE-VERCEL/api/discord`.

## Limites connues

- Les votes du sondage actuel comptent chaque clic. Ils ne garantissent pas encore un vote unique par membre.
- Les recommandations utilisent un catalogue local intégré au code ; elles ne consultent pas encore une base de données externe.
- Les fonctions automatiques déclenchées par les messages (XP, anti-spam en temps réel, accueil à l’arrivée) nécessitent un service Gateway persistant.
