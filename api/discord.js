const nacl = require('tweetnacl');
const waitUntil = task => { void task.catch(error => console.error('BACKGROUND_TASK_FAILED', error)); };
const API = 'https://discord.com/api/v10';
const EPHEMERAL = 64;
// Votes conservés pendant la durée de vie du processus Railway.
const cinemaPollVoters = new Map();
const PERM = { ADMIN: 8n, VIEW: '1024', SEND: '2048', MANAGE_MESSAGES: '8192', HISTORY: '65536', MANAGE_EVENTS: 8589934592n, CREATE_EVENTS: 17592186044416n };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method Not Allowed'); }
  const raw = await readRawBody(req);
  const sig = req.headers['x-signature-ed25519'];
  const ts = req.headers['x-signature-timestamp'];
  if (!isValidDiscordSignature(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY))
    return res.status(401).send('Invalid request signature');
  let interaction;
  try { interaction = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).send('Invalid JSON'); }
  if (interaction.type === 1) return res.status(200).json({ type: 1 });
  if (interaction.guild_id) {
    const eventName = interaction.type === 2 ? '/' + String(interaction.data?.name || 'commande-inconnue')
      : interaction.type === 3 ? 'Bouton : ' + String(interaction.data?.custom_id || 'interaction-inconnue')
      : 'Interaction type ' + interaction.type;
    waitUntil(logBotEvent(interaction.guild_id, '🧭 Interaction reçue', eventName, interaction));
  }
  if (interaction.type === 3) return handleCinemaComponent(interaction, res);
  if (interaction.type !== 2) return res.status(400).send('Unsupported interaction');

  const name = interaction.data && interaction.data.name;
    if (['warn','warnings','clear-warnings','timeout','untimeout','kick','ban'].includes(name)) {
    const permissionByCommand = { warn: 1099511627776n, warnings: 1099511627776n, 'clear-warnings': 1099511627776n, timeout: 1099511627776n, untimeout: 1099511627776n, kick: 2n, ban: 4n };
    if (!hasPermission(interaction.member?.permissions, permissionByCommand[name]) && !hasPermission(interaction.member?.permissions, PERM.ADMIN)) {
      return embedReply(res, { title: '🔒 Permission nécessaire', description: 'Tu ne disposes pas de la permission Discord requise pour cette action de modération.', color: 0xed4245 });
    }
    const opts = interaction.data.options || [];
    const get = key => opts.find(option => option.name === key)?.value;
    const targetId = get('membre');
    const reason = String(get('raison') || 'Aucune raison précisée').trim().slice(0, 450);
    const duration = Number(get('duree') || 10);
    if (!targetId || targetId === interaction.member?.user?.id && name !== 'warnings' && name !== 'clear-warnings')
      return embedReply(res, { title: '⚠️ Action impossible', description: 'Choisis un autre membre que toi-même.', color: 0xed4245 });
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    waitUntil((async () => {
      try {
        const [guildRoles, actor, target, botMember, channels] = await Promise.all([
          discord('/guilds/' + interaction.guild_id + '/roles'),
          discord('/guilds/' + interaction.guild_id + '/members/' + interaction.member.user.id),
          discord('/guilds/' + interaction.guild_id + '/members/' + targetId),
          discord('/guilds/' + interaction.guild_id + '/members/@me'),
          discord('/guilds/' + interaction.guild_id + '/channels')
        ]);
        const highest = member => Math.max(0, ...(member.roles || []).map(id => Number(guildRoles.find(role => role.id === id)?.position || 0)));
        if (target.user?.id === interaction.application_id) throw new Error('Je ne peux pas appliquer cette action à moi-même.');
        if (name !== 'warnings' && name !== 'clear-warnings' &&
            (highest(target) >= highest(actor) || highest(target) >= highest(botMember)))
          throw new Error('Le membre ciblé possède un rôle égal ou supérieur au tien ou au mien.');

        const logChannel = channels.find(item => item.name === '📋・logs-bot' && item.type === 0);
        if (!logChannel) throw new Error('Le salon 📋・logs-bot est introuvable.');

        const fetchWarnings = async () => {
          const messages = await discord('/channels/' + logChannel.id + '/messages?limit=100');
          return messages.filter(message => (message.content || '').includes('[CINEBOX_WARN:' + targetId + ']'));
        };

        if (name === 'warnings') {
          const messages = await fetchWarnings();
          const entries = messages.filter(message => !(message.content || '').includes('[CINEBOX_WARN_CLEAR:' + targetId + ']'));
          const clearedAt = messages.filter(message => (message.content || '').includes('[CINEBOX_WARN_CLEAR:' + targetId + ']'))
            .reduce((max, message) => Math.max(max, Date.parse(message.timestamp) || 0), 0);
          const active = entries.filter(message => (Date.parse(message.timestamp) || 0) > clearedAt);
          const description = active.length
            ? active.slice(0, 15).map((message, index) => {
                const embed = message.embeds?.[0] || {};
                return '**' + (index + 1) + '.** ' + (embed.description || message.content).replace('[CINEBOX_WARN:' + targetId + ']', '').slice(0, 300);
              }).join('\\n')
            : 'Aucun avertissement actif enregistré pour ce membre.';
          await editOriginal(interaction, { content: '', embeds: [{ title: '📋 Avertissements de ' + (target.user?.username || targetId), description: '**Total actif :** ' + active.length + '\\n\\n' + description, color: 0xd8b45a, timestamp: new Date().toISOString() }] });
          return;
        }

        if (name === 'clear-warnings') {
          await discord('/channels/' + logChannel.id + '/messages', { method: 'POST', body: { content: '[CINEBOX_WARN_CLEAR:' + targetId + '] Effacement effectué par <@' + interaction.member.user.id + '> — ' + reason } });
          await logBotEvent(interaction.guild_id, '🧹 Avertissements effacés', '**Membre :** <@' + targetId + '>\\n**Modérateur :** <@' + interaction.member.user.id + '>\\n**Motif :** ' + reason, interaction);
          await editOriginal(interaction, { content: '', embeds: [{ title: '✅ Historique réinitialisé', description: 'Les avertissements actifs de <@' + targetId + '> ont été effacés.', color: 0x57f287 }] });
          return;
        }

        if (name === 'warn') {
          await discord('/channels/' + logChannel.id + '/messages', { method: 'POST', body: { content: '[CINEBOX_WARN:' + targetId + ']', embeds: [{ title: '⚠️ Avertissement officiel', description: '**Membre :** <@' + targetId + '>\\n**Modérateur :** <@' + interaction.member.user.id + '>\\n**Motif :** ' + reason, color: 0xd8b45a, timestamp: new Date().toISOString() }] } });
        } else if (name === 'timeout') {
          if (!Number.isInteger(duration) || duration < 1 || duration > 40320) throw new Error('La durée doit être comprise entre 1 et 40 320 minutes (28 jours).');
          await discord('/guilds/' + interaction.guild_id + '/members/' + targetId, { method: 'PATCH', body: { communication_disabled_until: new Date(Date.now() + duration * 60000).toISOString() } });
          await logBotEvent(interaction.guild_id, '🔇 Mise en sourdine', '**Membre :** <@' + targetId + '>\\n**Durée :** ' + duration + ' minutes\\n**Motif :** ' + reason, interaction);
        } else if (name === 'untimeout') {
          await discord('/guilds/' + interaction.guild_id + '/members/' + targetId, { method: 'PATCH', body: { communication_disabled_until: null } });
          await logBotEvent(interaction.guild_id, '🔊 Fin de mise en sourdine', '**Membre :** <@' + targetId + '>\\n**Motif :** ' + reason, interaction);
        } else if (name === 'kick') {
          await discord('/guilds/' + interaction.guild_id + '/members/' + targetId, { method: 'DELETE' });
          await logBotEvent(interaction.guild_id, '👢 Membre expulsé', '**Membre :** ' + (target.user?.username || targetId) + '\\n**Motif :** ' + reason, interaction);
        } else if (name === 'ban') {
          await discord('/guilds/' + interaction.guild_id + '/bans/' + targetId, { method: 'PUT', body: { delete_message_seconds: 0, reason: ('CinéBox : ' + reason).slice(0, 480) } });
          await logBotEvent(interaction.guild_id, '🔨 Membre banni', '**Membre :** ' + (target.user?.username || targetId) + '\\n**Motif :** ' + reason, interaction);
        }
        await editOriginal(interaction, { content: '', embeds: [{ title: '✅ Modération effectuée', description: 'Action : **/' + name + '**\\nMembre : <@' + targetId + '>\\nMotif : ' + reason, color: 0x57f287, timestamp: new Date().toISOString() }] });
      } catch (error) {
        console.error('CINEBOX_MODERATION_FAILED', name, error?.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Modération impossible', description: String(error.message || error).slice(0, 900), color: 0xed4245 }] });
      }
    })());
    return;
  }


  if (name === 'sondage-cinema') {
    if (!process.env.DISCORD_TOKEN || !interaction.channel_id) return embedReply(res, { title: '⚠️ Configuration incomplète', description: 'Le sondage ne peut pas être publié dans ce contexte.', color: 0xed4245 });
    const opts = interaction.data.options || [];
    const get = key => opts.find(option => option.name === key)?.value;
    const title = String(get('titre') || '').trim();
    const films = ['film1','film2','film3','film4'].map(get).filter(Boolean).map(x => String(x).trim()).filter(Boolean);
    if (!title || films.length < 2) return embedReply(res, { title: '📝 Sondage incomplet', description: 'Ajoute un titre et au moins deux films pour lancer le vote.', color: 0xed4245 });
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    const task = (async () => {
      try {
        const embed = {
          author: { name: 'CINÉBOX  /  LE CHOIX DE LA COMMUNAUTÉ' },
          title: '🍿 ' + title.slice(0, 240),
          description: 'La communauté choisit la prochaine séance.\n\n**Comment voter ?** Clique sur le bouton correspondant à ton film favori. Le compteur se met à jour sur ce message.\n\n*Un seul vote par membre. Le classement se met à jour après chaque participation.*',
          color: 0xd8b45a,
          fields: films.map((film, index) => ({ name: String(index + 1).padStart(2, '0') + '  /  ' + film.slice(0, 220), value: '🎟️  **0 voix**', inline: true })),
          footer: { text: 'CINÉBOX  •  VOTE COMMUNAUTAIRE  •  🍿' },
          timestamp: new Date().toISOString()
        };
        const components = [{ type: 1, components: films.map((film, index) => ({
          type: 2, style: 1, custom_id: 'cine_vote_' + index, label: 'Voter · ' + film.slice(0, 65)
        })) }];
        await discord('/channels/' + interaction.channel_id + '/messages', {
          method: 'POST', body: { content: '🎬 **Nouveau sondage cinéma !**', embeds: [embed], components }
        });
        await editOriginal(interaction, { content: '', embeds: [{ title: '🍿 Sondage publié !', description: 'Ton sondage est en ligne dans ce salon. Les membres peuvent maintenant choisir leur film préféré.', color: 0x57f287, footer: { text: 'CinéBox • Organisation des séances' }, timestamp: new Date().toISOString() }] });
      } catch (error) {
        console.error('CINEMA_POLL_CREATE_FAILED', error && error.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Publication impossible', description: 'Le sondage n’a pas pu être publié. Vérifie les permissions Voir le salon, Envoyer des messages et Intégrer des liens.', color: 0xed4245, footer: { text: 'CinéBox • Assistance' } }] });
      }
    })();
    waitUntil(task);
    return;
  }

  if (name === 'tirage-cinema') {
    const opts = interaction.data.options || [];
    const films = ['film1','film2','film3','film4']
      .map(key => opts.find(option => option.name === key)?.value)
      .filter(Boolean)
      .map(value => String(value).trim())
      .filter(Boolean);
    if (films.length < 2) return embedReply(res, { title: '🎲 Tirage impossible', description: 'Ajoute au moins **deux films** pour lancer le tirage au sort.', color: 0xed4245 });
    const winner = films[Math.floor(Math.random() * films.length)];
    const others = films.filter(film => film !== winner);
    const description = 'Le hasard a parlé… Préparez le pop-corn et installez-vous ! 🍿\n\n' +
      '**🎞️ Film sélectionné**\n# ' + winner.slice(0, 200) +
      (others.length ? '\n\n**Autres films en compétition**\n' + others.map(film => '• ' + film.slice(0, 100)).join('\n') : '');
    return res.status(200).json({
      type: 4,
      data: {
        flags: EPHEMERAL,
        embeds: [{
          author: { name: 'CINÉBOX  /  LE HASARD A PARLÉ' },
          title: '🎬 LA SÉANCE EST CHOISIE !',
          description,
          color: 0xd8b45a,
          footer: { text: 'CINÉBOX  •  LE FILM DU CLUB  •  🍿' },
          timestamp: new Date().toISOString()
        }]
      }
    });
  }

  if (name === 'recommandation-cinema') {
    const opts = interaction.data.options || [];
    const genre = opts.find(option => option.name === 'genre')?.value || 'tous';
    const mood = opts.find(option => option.name === 'ambiance')?.value || 'surprise';
    return res.status(200).json({
      type: 4,
      data: {
        flags: EPHEMERAL,
        embeds: [buildRecommendationEmbed(genre, mood)],
        components: buildRecommendationComponents(genre, mood)
      }
    });
  }

  if (name === 'quiz-cinema') {
    const questionIndex = Math.floor(Math.random() * CINEMA_QUIZ.length);
    return res.status(200).json({
      type: 4,
      data: {
        flags: EPHEMERAL,
        embeds: [buildQuizQuestionEmbed(questionIndex)],
        components: [buildQuizQuestionButtons(questionIndex)]
      }
    });
  }

  if (name === 'programmer-seance') {
    if (!hasPermission(interaction.member?.permissions, PERM.CREATE_EVENTS) && !hasPermission(interaction.member?.permissions, PERM.MANAGE_EVENTS) && !hasPermission(interaction.member?.permissions, PERM.ADMIN)) {
      return embedReply(res, { title: '🔒 Permission nécessaire', description: 'La programmation d’une séance nécessite la permission Créer des événements (ou Gérer les événements).', color: 0xed4245 });
    }
    if (!process.env.DISCORD_TOKEN || !interaction.guild_id) return embedReply(res, { title: '⚠️ Configuration incomplète', description: 'Le bot ne peut pas accéder au serveur.', color: 0xed4245 });
    const opts = interaction.data.options || [];
    const get = key => opts.find(option => option.name === key)?.value;
    const film = String(get('film') || '').trim();
    const date = String(get('date') || '').trim();
    const heure = String(get('heure') || '').trim();
    const channelId = get('salon');
    const duration = get('duree') || 120;
    const details = String(get('description') || '').trim();
    const start = parisDateTimeToDate(date, heure);
    if (!film || !channelId || !start) {
      return embedReply(res, { title: '📝 Informations invalides', description: 'Vérifie le film, le salon vocal, la date AAAA-MM-JJ et l’heure HH:MM (heure de Paris). Certaines heures n’existent pas lors du changement d’heure.', color: 0xed4245 });
    }
    if (start.getTime() < Date.now() + 10 * 60 * 1000) {
      return embedReply(res, { title: '⏰ Séance trop proche', description: 'Choisis une date située au moins 10 minutes dans le futur.', color: 0xed4245 });
    }
    const end = new Date(start.getTime() + Math.min(360, Math.max(60, Number(duration))) * 60000);
    const unixStart = Math.floor(start.getTime() / 1000);
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    const task = (async () => {
      try {
        const event = await discord('/guilds/' + interaction.guild_id + '/scheduled-events', {
          method: 'POST',
          body: {
            name: '🍿 CinéBox — ' + film.slice(0, 80),
            description: (details || 'Une séance cinéma organisée par la communauté CinéBox.') + '\n\nFilm : ' + film,
            scheduled_start_time: start.toISOString(),
            scheduled_end_time: end.toISOString(),
            privacy_level: 2,
            entity_type: 2,
            channel_id: channelId
          }
        });
        await editOriginal(interaction, { content: '', embeds: [{
          author: { name: 'CINÉBOX  /  PROGRAMMATION DES SÉANCES' },
          title: '🍿 La séance est officiellement programmée !',
          description: '**' + film + '**\n\n📅 <t:' + unixStart + ':F>\n⏳ <t:' + unixStart + ':R>\n🔊 <#' + channelId + '>\n\n[Voir l’événement Discord](https://discord.com/events/' + interaction.guild_id + '/' + event.id + ')',
          color: 0x57f287,
          footer: { text: 'CINÉBOX  •  RENDEZ-VOUS AU CINÉ-CLUB  •  🍿' },
          timestamp: new Date().toISOString()
        }] });
      } catch (error) {
        console.error('CINEMA_EVENT_CREATE_FAILED', error && error.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Événement non créé', description: 'Discord a refusé la création. Vérifie que le bot possède la permission Gérer les événements et peut accéder au salon vocal.\n\n' + String(error.message || error).slice(0, 500), color: 0xed4245 }] });
      }
    })();
    waitUntil(task);
    return;
  }

  if (name === 'config-accueil') {
    if (!hasPermission(interaction.member?.permissions, PERM.ADMIN)) return embedReply(res, { title: '🔒 Accès réservé', description: 'Seuls les administrateurs peuvent configurer les notifications.', color: 0xed4245 });
    if (!interaction.guild_id) return embedReply(res, { title: '⚠️ Serveur introuvable', description: 'Cette commande doit être utilisée dans un serveur.', color: 0xed4245 });
    const opts = interaction.data.options || [];
    const get = key => opts.find(option => option.name === key)?.value;
    const welcomeChannelId = get('salon-bienvenue');
    const goodbyeChannelId = get('salon-depart');
    const welcomeEnabled = get('activer-bienvenue');
    const goodbyeEnabled = get('activer-depart');
    const autoRoleEnabled = get('role-automatique');
    const newMemberRoleId = get('role-nouveau');
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    const task = (async () => {
      try {
        const channels = await discord('/guilds/' + interaction.guild_id + '/channels');
        const configChannel = channels.find(channel => channel.name === '📋•journal-équipe' && channel.type === 0);
        if (!configChannel) throw new Error('Le salon privé 📋•journal-équipe est introuvable. Lance /setup pour créer la structure CinéBox.');
        const prefix = 'CINEBOX_WELCOME_CONFIG:';
        let current = { welcomeEnabled: false, goodbyeEnabled: false, autoRoleEnabled: false, welcomeChannelId: null, goodbyeChannelId: null, newMemberRoleId: null };
        const topic = configChannel.topic || '';
        const saved = topic.match(/CINEBOX_WELCOME_CONFIG:(\\{[^}]*\\})/);
        if (saved) { try { current = Object.assign(current, JSON.parse(saved[1])); } catch {} }
        const validateChannel = id => !id || channels.some(channel => channel.id === id && channel.type === 0);
        if (welcomeChannelId && !validateChannel(welcomeChannelId)) throw new Error('Le salon de bienvenue doit être un salon textuel de ce serveur.');
        if (goodbyeChannelId && !validateChannel(goodbyeChannelId)) throw new Error('Le salon de départ doit être un salon textuel de ce serveur.');
        const roles = await discord('/guilds/' + interaction.guild_id + '/roles');
        if (newMemberRoleId && !roles.some(role => role.id === newMemberRoleId)) throw new Error('Le rôle sélectionné ne fait pas partie de ce serveur.');
        if (welcomeChannelId !== undefined) current.welcomeChannelId = welcomeChannelId;
        if (goodbyeChannelId !== undefined) current.goodbyeChannelId = goodbyeChannelId;
        if (welcomeEnabled !== undefined) current.welcomeEnabled = welcomeEnabled;
        if (goodbyeEnabled !== undefined) current.goodbyeEnabled = goodbyeEnabled;
        if (autoRoleEnabled !== undefined) current.autoRoleEnabled = autoRoleEnabled;
        if (newMemberRoleId !== undefined) current.newMemberRoleId = newMemberRoleId;
        const encoded = prefix + JSON.stringify(current);
        const otherTopic = topic.replace(/(?:^|\\s*)CINEBOX_WELCOME_CONFIG:\\{[^}]*\\}/, '').trim();
        const nextTopic = [otherTopic, encoded].filter(Boolean).join(' ').slice(0, 1024);
        await discord('/channels/' + configChannel.id, { method: 'PATCH', body: { topic: nextTopic } });
        const channelLabel = id => id ? '<#' + id + '>' : 'Non configuré';
        await editOriginal(interaction, { content: '', embeds: [{
          author: { name: 'CINÉBOX  /  PARAMÈTRES DU CLUB' },
          title: '⚙️ Notifications configurées',
          description: 'Les réglages sont enregistrés dans le salon privé de l’équipe. Rien ne sera publié tant que tu n’actives pas les options correspondantes.',
          color: 0xd8b45a,
          fields: [
            { name: '👋 Bienvenue', value: (current.welcomeEnabled ? '🟢 Activé' : '⚫ Désactivé') + '\nSalon : ' + channelLabel(current.welcomeChannelId), inline: true },
            { name: '🌙 Départs', value: (current.goodbyeEnabled ? '🟢 Activé' : '⚫ Désactivé') + '\nSalon : ' + channelLabel(current.goodbyeChannelId), inline: true },
            { name: '🍿 Rôle automatique', value: (current.autoRoleEnabled ? '🟢 Activé' : '⚫ Désactivé') + '\nRôle : ' + (current.newMemberRoleId ? '<@&' + current.newMemberRoleId + '>' : 'Non configuré'), inline: true }
          ],
          footer: { text: 'CINÉBOX  •  CONFIGURATION ADMINISTRATEUR' },
          timestamp: new Date().toISOString()
        }] });
      } catch (error) {
        console.error('CINEBOX_WELCOME_CONFIG_FAILED', error && error.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Configuration impossible', description: String(error.message || error).slice(0, 900), color: 0xed4245 }] });
      }
    })();
    waitUntil(task);
    return;
  }

  if (name === 'reset-cinebox') {
    if (!hasPermission(interaction.member?.permissions, PERM.ADMIN)) return embedReply(res, { title: '🔒 Accès réservé', description: 'La remise à zéro est réservée aux administrateurs.', color: 0xed4245 });
    return res.status(200).json({ type: 4, data: { flags: EPHEMERAL, embeds: [{ title: '⚠️ Remise à zéro de CinéBox', description: 'Cette action supprimera les salons, catégories et rôles gérés par CinéBox. Les autres éléments du serveur ne seront pas touchés.\n\n**Cette action est définitive.** Confirme uniquement si tu veux vraiment retirer la structure CinéBox.', color: 0xed4245, footer: { text: 'CINÉBOX • CONFIRMATION ADMINISTRATEUR' } }], components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: 'cinebox_reset_confirm', label: 'Tout supprimer' }, { type: 2, style: 2, custom_id: 'cinebox_reset_cancel', label: 'Annuler' }] }] } });
  }

  if (name === 'ping') {
    const elapsed = interaction.id ? Math.max(0, Date.now() - Number((BigInt(interaction.id) >> 22n) + 1420070400000n)) : null;
    return embedReply(res, {
      author: { name: 'CINÉBOX  /  SYSTÈME DE PROJECTION' },
      title: '🎬 CONTRÔLE DE PROJECTION',
      description: '## 🟢 Tout est prêt !\nLe bot est opérationnel et répond aux commandes.',
      color: 0x57f287,
      fields: [
        { name: 'ÉTAT DU BOT', value: '🟢 **En ligne**', inline: true },
        { name: 'TEMPS DE TRAITEMENT', value: elapsed === null ? 'Mesure indisponible' : '**' + elapsed + ' ms**', inline: true },
        { name: 'PROCHAINE ÉTAPE', value: 'Choisis un film avec `/sondage-cinema` ou lance un tirage avec `/tirage-cinema`.' }
      ],
      footer: { text: 'CINÉBOX  •  SYSTÈME OPÉRATIONNEL  •  🍿' },
      timestamp: new Date().toISOString()
    });
  }
  if (name === 'help') return res.status(200).json({
    type: 4,
    data: {
      flags: EPHEMERAL,
      embeds: [{
        author: { name: 'CINÉBOX  /  LE CLUB DES CINÉPHILES' },
        title: '🎟️ TON PASS POUR LA PROCHAINE SÉANCE',
        description: 'Bienvenue dans ton espace de contrôle CinéBox.\nExplore les outils du club, organise les soirées et partage ta passion du cinéma.\n\n*Une commande, et la séance commence.*',
        color: 0xd8b45a,
        fields: [
          { name: '🍿  À L’AFFICHE', value: '`/sondage-cinema`\nLance un vote communautaire pour choisir le prochain film.\n\n`/tirage-cinema`\nLaisse le hasard décider entre plusieurs films.\n\n`/recommandation-cinema`\nTrouve un film selon ton genre et ton humeur.\n\n`/quiz-cinema`\nTeste tes connaissances avec un quiz interactif.', inline: false },
          { name: '🎭  LA COMMUNAUTÉ', value: '`/suggestion`\nPartage une idée pour faire évoluer le club.\n\n`/signaler`\nTransmets un bug ou un problème à l’équipe.', inline: false },
          { name: '🎬  ORGANISATION DU CLUB', value: '`/programmer-seance`\nCrée un événement officiel dans un salon vocal *(permission Créer des événements)*.\n\n`/ping`\nVérifie que CinéBox répond.\n\n`/setup`\nInstalle ou répare les salons et les rôles *(administrateurs)*.', inline: false }
        ],
        footer: { text: 'CINÉBOX  •  LE CLUB DES CINÉPHILES  •  🍿' },
        timestamp: new Date().toISOString()
      }]
    }
  });

  if (name === 'setup') {
    if (!hasPermission(interaction.member?.permissions, PERM.ADMIN)) return embedReply(res, { title: '🔒 Accès réservé', description: 'La configuration du serveur est réservée aux administrateurs.', color: 0xed4245, footer: { text: 'CinéBox • Permissions' } });
    if (!process.env.DISCORD_TOKEN || !interaction.guild_id) return embedReply(res, { title: '⚠️ Configuration incomplète', description: 'CinéBox ne dispose pas de tous les paramètres nécessaires. Préviens un administrateur.', color: 0xed4245 });
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    console.log('SETUP_START', interaction.guild_id);
    const task = (async () => {
      try {
        console.log('SETUP_BACKGROUND_TASK_STARTED', interaction.guild_id);
        const result = await setupGuild(interaction.guild_id, async (state) => {
          const percent = Math.min(100, Math.round(state.done / state.total * 100));
          const filled = Math.round(percent / 10);
          const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
          const progressEmbed = {
            author: { name: 'CINÉBOX  /  CONFIGURATION DU CLUB' },
            title: '🎬 INSTALLATION DE CINÉBOX',
            description: bar + ' **' + percent + '%**\n\n' + (state.label || 'Préparation en cours…'),
            color: 0xd8b45a,
            fields: [
              { name: 'Étape', value: state.done + ' / ' + state.total, inline: true },
              { name: 'Créés', value: String(state.created), inline: true },
              { name: 'Vérifiés', value: String(state.checked), inline: true }
            ],
            footer: { text: 'CINÉBOX  •  MISE EN PLACE DE VOTRE ESPACE  •  🍿' },
            timestamp: new Date().toISOString()
          };
          console.log('SETUP_PROGRESS', JSON.stringify(state));
          // Never let a slow Discord webhook update block the actual setup work.
          void editOriginal(interaction, { content: '', embeds: [progressEmbed] });
        });
        const details = result.created.length ? result.created.map(x => '• ' + x).join('\n') : 'Tout était déjà en place : aucun doublon créé.';
        console.log('SETUP_SUCCESS', result);
        await editOriginal(interaction, { content: '', embeds: [{ author: { name: 'CINÉBOX  /  CONFIGURATION TERMINÉE' },
          title: '✨ VOTRE SERVEUR EST PRÊT !', description: 'La structure du club a été installée avec succès. Place à la communauté ! 🍿', color: 0x57f287, fields: [{ name: 'Éléments créés', value: String(result.created.length), inline: true }, { name: 'Rôles', value: String(result.roles), inline: true }, { name: 'Salons texte', value: String(result.textChannels), inline: true }, { name: 'Salons vocaux', value: String(result.voiceChannels), inline: true }, { name: 'Détails', value: details.slice(0, 1000) }], footer: { text: 'CINÉBOX  •  BIENVENUE DANS LE CLUB  •  🍿' }, timestamp: new Date().toISOString() }] });
      } catch (error) {
        console.error('SETUP_FAILED', error && error.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ author: { name: 'CINÉBOX  /  ASSISTANCE TECHNIQUE' },
          title: '⚠️ INSTALLATION INTERROMPUE', description: 'CinéBox n’a pas pu terminer la configuration.\n\n`' + String(error.message || error).slice(0, 700) + '`', color: 0xed4245, footer: { text: 'CINÉBOX  •  ASSISTANCE ADMINISTRATEUR' },
          timestamp: new Date().toISOString() }] });
      }
    })();
    waitUntil(task);
    return;
  }

  if (name === 'signaler' || name === 'suggestion') {
    const report = name === 'signaler';
    const optionName = report ? 'message' : 'idee';
    const value = interaction.data.options && interaction.data.options.find(x => x.name === optionName)?.value;
    if (!value || !process.env.DISCORD_TOKEN || !interaction.guild_id) return embedReply(res, { title: '⚠️ Envoi impossible', description: 'Il manque des informations pour transmettre ta demande. Préviens un administrateur.', color: 0xed4245 });
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    const task = (async () => {
      try {
        const configuredId = report ? process.env.REPORT_CHANNEL_ID : process.env.SUGGESTION_CHANNEL_ID;
        let channelId = configuredId;
        if (!channelId) {
          const channels = await discord('/guilds/' + interaction.guild_id + '/channels');
          const targetName = report ? '🐛•signaler-un-bug' : '💡•boîte-à-idées';
          channelId = channels.find(c => c.name === targetName && c.type === 0)?.id;
        }
        if (!channelId) {
          await editOriginal(interaction, { content: '', embeds: [{ title: '🔎 Salon introuvable', description: 'Le salon de destination n’a pas été trouvé. Demande à un administrateur de vérifier la configuration avec /setup.', color: 0xed4245 }] });
          return;
        }
        await discord('/channels/' + channelId + '/messages', { method: 'POST', body: {
          embeds: [{
            title: report ? '🐛 Nouveau signalement' : '💡 Nouvelle suggestion',
            description: String(value).slice(0, 1500),
            color: report ? 0xef8354 : 0xd8b45a,
            fields: [
              { name: 'Membre', value: interaction.member?.user?.username || interaction.user?.username || 'Membre', inline: true },
              { name: 'Serveur', value: interaction.guild_id || 'Inconnu', inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        }});
        await editOriginal(interaction, { content: '', embeds: [{ title: report ? '🐛 Signalement transmis' : '💡 Suggestion envoyée', description: report ? 'Merci de nous avoir prévenus. L’équipe CinéBox pourra examiner ton signalement.' : 'Merci de contribuer à faire évoluer CinéBox. Ton idée a bien été transmise à l’équipe.', color: 0x57f287, footer: { text: 'CinéBox • Merci pour ta participation' }, timestamp: new Date().toISOString() }] });
      } catch (error) {
        console.error('Message delivery failed:', error && error.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Transmission échouée', description: 'Ta demande n’a pas pu être transmise. Réessaie dans quelques instants ou contacte un membre de l’équipe.', color: 0xed4245 }] });
      }
    })();
    waitUntil(task);
    return;
  }

  return reply(res, 'Commande inconnue.');
};

function handleCinemaVote(interaction, res) {
  const customId = interaction.data && interaction.data.custom_id || '';
  const match = /^cine_vote_([0-9]+)$/.exec(customId);
  if (!match || !interaction.message || !interaction.message.embeds || !interaction.message.embeds[0]) {
    return res.status(200).json({ type: 4, data: { content: 'Ce vote n’est plus disponible.', flags: EPHEMERAL } });
  }
  const index = Number(match[1]);
  const messageId = interaction.message.id;
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const embed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
  const fields = embed.fields || [];
  if (!Number.isInteger(index) || index < 0 || index >= fields.length || !userId || !messageId) {
    return res.status(200).json({ type: 4, data: { content: 'Option de vote invalide.', flags: EPHEMERAL } });
  }
  let voters = cinemaPollVoters.get(messageId);
  if (!voters) { voters = new Set(); cinemaPollVoters.set(messageId, voters); }
  if (voters.has(userId)) {
    return res.status(200).json({ type: 4, data: { content: '🍿 Tu as déjà voté dans ce sondage. Un seul vote par membre !', flags: EPHEMERAL } });
  }
  // Marquer le membre avant de construire la réponse évite les doubles clics simultanés.
  voters.add(userId);
  const current = Number.parseInt(String(fields[index].value || '0').replace(/[^0-9]/g, ''), 10) || 0;
  const nextCount = current + 1;
  fields[index].value = '🎟️  **' + nextCount + (nextCount > 1 ? ' voix**' : ' voix**');
  embed.fields = fields;
  const ranking = fields.map((field, i) => ({
    name: String(field.name).split('  /  ').slice(1).join('  /  ') || String(field.name),
    count: Number.parseInt(String(field.value || '0').replace(/[^0-9]/g, ''), 10) || 0,
    index: i
  })).sort((a, b) => b.count - a.count || a.index - b.index);
  embed.description = 'Un seul vote par membre. Merci de participer ! 🍿\n\n**🏆 Classement actuel**\n' +
    ranking.map((item, i) => (i + 1) + '. **' + item.name + '** — ' + item.count + (item.count > 1 ? ' voix' : ' voix')).join('\\n');
  const components = [{ type: 1, components: fields.map((field, i) => ({
    type: 2,
    style: i === index ? 3 : 1,
    custom_id: 'cine_vote_' + i,
    label: 'Voter · ' + (String(field.name).split('  /  ').slice(1).join('  /  ') || String(field.name)).slice(0, 65)
  })) }];
  console.log('CINEMA_VOTE', JSON.stringify({ guild: interaction.guild_id, message: messageId, option: index }));
  return res.status(200).json({ type: 7, data: { embeds: [embed], components } });
}

const MOVIE_LIBRARY = [
  { title: 'Interstellar', year: 2014, duration: 169, genres: ['science-fiction','aventure','drame'], moods: ['evasion','emotion','reflexion'], synopsis: 'Dans un futur où la Terre devient difficilement habitable, une équipe part chercher un nouvel horizon pour l’humanité.', pitch: 'Une grande aventure spatiale, spectaculaire et profondément humaine.' },
  { title: 'Le Voyage de Chihiro', year: 2001, duration: 125, genres: ['animation','aventure'], moods: ['evasion','emotion','reflexion'], synopsis: 'Une jeune fille découvre un monde mystérieux peuplé d’esprits et doit trouver le courage de sauver ses proches.', pitch: 'Un univers merveilleux, inventif et inoubliable.' },
  { title: 'Intouchables', year: 2011, duration: 112, genres: ['comedie','drame'], moods: ['detente','emotion'], synopsis: 'Une amitié inattendue bouleverse le quotidien de deux hommes que tout semble opposer.', pitch: 'De l’humour, de la tendresse et une belle dose d’humanité.' },
  { title: 'Spider-Man: New Generation', year: 2018, duration: 117, genres: ['animation','aventure','science-fiction'], moods: ['detente','evasion'], synopsis: 'Miles Morales découvre qu’il n’est pas le seul Spider-Man et que plusieurs univers peuvent se rencontrer.', pitch: 'Une animation inventive et une énergie visuelle incroyable.' },
  { title: 'Get Out', year: 2017, duration: 104, genres: ['thriller','drame'], moods: ['frissons','reflexion'], synopsis: 'Un week-end chez la famille de sa compagne prend une tournure de plus en plus inquiétante.', pitch: 'Un thriller tendu qui donne matière à discuter après le générique.' },
  { title: 'La La Land', year: 2016, duration: 128, genres: ['comedie','drame'], moods: ['detente','emotion'], synopsis: 'À Los Angeles, une actrice et un musicien poursuivent leurs rêves et tentent de faire une place à leur histoire.', pitch: 'Une parenthèse musicale, colorée et pleine d’émotion.' },
  { title: 'Mad Max: Fury Road', year: 2015, duration: 120, genres: ['aventure','science-fiction','thriller'], moods: ['frissons','evasion'], synopsis: 'Dans un désert post-apocalyptique, une fuite spectaculaire devient une course pour la liberté.', pitch: 'De l’action presque sans pause et une mise en scène impressionnante.' },
  { title: 'Ratatouille', year: 2007, duration: 111, genres: ['animation','comedie'], moods: ['detente','emotion'], synopsis: 'Un rat passionné de cuisine rêve de faire découvrir ses talents dans les cuisines parisiennes.', pitch: 'Un film chaleureux, drôle et délicieusement réconfortant.' },
  { title: 'The Truman Show', year: 1998, duration: 103, genres: ['comedie','drame','science-fiction'], moods: ['reflexion','detente'], synopsis: 'Un homme commence à douter de la réalité parfaite dans laquelle il vit depuis toujours.', pitch: 'Une idée brillante, drôle et toujours aussi pertinente.' },
  { title: 'Le Seigneur des anneaux : La Communauté de l’anneau', year: 2001, duration: 178, genres: ['aventure','drame'], moods: ['evasion','emotion'], synopsis: 'Un jeune Hobbit entreprend un voyage dangereux pour empêcher un anneau de tomber entre de mauvaises mains.', pitch: 'Une aventure épique idéale pour s’évader complètement.' },
  { title: 'À couteaux tirés', year: 2019, duration: 130, genres: ['comedie','thriller'], moods: ['reflexion','detente'], synopsis: 'Après la mort d’un patriarche, un détective interroge une famille où chacun semble avoir quelque chose à cacher.', pitch: 'Une enquête pleine de surprises, parfaite pour jouer au détective.' },
  { title: 'Dune', year: 2021, duration: 155, genres: ['science-fiction','aventure','drame'], moods: ['evasion','reflexion'], synopsis: 'Sur la planète désertique Arrakis, un jeune héritier se retrouve au cœur d’enjeux politiques et prophétiques.', pitch: 'Une fresque de science-fiction ample et immersive.' },
  { title: 'Coco', year: 2017, duration: 105, genres: ['animation','aventure'], moods: ['emotion','detente'], synopsis: 'Un jeune passionné de musique traverse le monde des morts pour comprendre l’histoire de sa famille.', pitch: 'Une aventure colorée qui touche droit au cœur.' },
  { title: 'Shutter Island', year: 2010, duration: 138, genres: ['thriller','drame'], moods: ['frissons','reflexion'], synopsis: 'Deux enquêteurs arrivent sur une île isolée pour élucider la disparition d’une patiente.', pitch: 'Une atmosphère troublante et un mystère à décortiquer.' },
  { title: 'Le Château ambulant', year: 2004, duration: 119, genres: ['animation','aventure'], moods: ['evasion','emotion'], synopsis: 'Une jeune femme transformée par un sort trouve refuge dans le château magique d’un mystérieux magicien.', pitch: 'Une escapade poétique dans un monde plein de magie.' },
  { title: 'Paddington 2', year: 2017, duration: 104, genres: ['comedie','aventure'], moods: ['detente','emotion'], synopsis: 'Le plus poli des ours veut offrir un cadeau spécial à sa tante, mais une mésaventure bouleverse ses plans.', pitch: 'Un film lumineux, drôle et incroyablement feel-good.' },
  { title: 'Les Évadés', year: 1994, duration: 142, genres: ['drame'], moods: ['emotion','reflexion'], synopsis: 'Une amitié se construit au fil des années dans une prison où l’espoir devient une force essentielle.', pitch: 'Un récit puissant sur l’amitié, la patience et la liberté.' },
  { title: 'Inception', year: 2010, duration: 148, genres: ['science-fiction','thriller','aventure'], moods: ['frissons','reflexion'], synopsis: 'Une équipe spécialisée s’introduit dans les rêves pour accomplir une mission hors du commun.', pitch: 'Un puzzle spectaculaire qui donne envie de revoir le film.' },
  { title: 'Sans un bruit', year: 2018, duration: 90, genres: ['thriller','science-fiction'], moods: ['frissons'], synopsis: 'Une famille tente de survivre dans un monde où le moindre bruit peut attirer une menace.', pitch: 'Une expérience de tension très efficace à partager.' }
];

const CINEMA_QUIZ = [
  { question: 'Quel réalisateur a signé Jurassic Park (1993) ?', answers: ['James Cameron','Steven Spielberg','Ridley Scott','Tim Burton'], correct: 1, explanation: 'Steven Spielberg a réalisé Jurassic Park, adapté du roman de Michael Crichton.' },
  { question: 'Sur quelle planète se déroule l’essentiel de Dune ?', answers: ['Krypton','Tatooine','Arrakis','Pandora'], correct: 2, explanation: 'Arrakis, aussi appelée Dune, est la planète désertique au centre de l’histoire.' },
  { question: 'Quel est le prénom du lionceau héros du Roi Lion ?', answers: ['Mufasa','Scar','Simba','Kovu'], correct: 2, explanation: 'Simba est le fils de Mufasa et le personnage principal du Roi Lion.' },
  { question: 'Dans Matrix, quelle pilule Neo choisit-il pour découvrir la vérité ?', answers: ['La bleue','La rouge','La verte','La blanche'], correct: 1, explanation: 'Neo choisit la pilule rouge, qui lui permet de découvrir la réalité.' },
  { question: 'Qui incarne Jack Sparrow dans Pirates des Caraïbes ?', answers: ['Orlando Bloom','Geoffrey Rush','Johnny Depp','Javier Bardem'], correct: 2, explanation: 'Johnny Depp interprète le capitaine Jack Sparrow.' },
  { question: 'Comment s’appelle le robot héros de WALL-E ?', answers: ['EVE','AUTO','WALL-E','MO'], correct: 2, explanation: 'WALL-E est un robot compacteur de déchets qui travaille sur une Terre abandonnée.' },
  { question: 'Dans quel univers trouve-t-on Poudlard ?', answers: ['Le Seigneur des anneaux','Harry Potter','Narnia','Percy Jackson'], correct: 1, explanation: 'Poudlard est l’école de sorcellerie de la saga Harry Potter.' },
  { question: 'Quel est le nom du vaisseau de Han Solo ?', answers: ['X-Wing','Enterprise','Faucon Millenium','Nostromo'], correct: 2, explanation: 'Le Faucon Millenium est le célèbre vaisseau piloté par Han Solo et Chewbacca.' },
  { question: 'Quel studio a créé Toy Story ?', answers: ['DreamWorks','Pixar','Ghibli','Illumination'], correct: 1, explanation: 'Toy Story est le premier long métrage entièrement réalisé en images de synthèse par Pixar.' },
  { question: 'Dans Retour vers le futur, quel scientifique invente la machine à voyager dans le temps ?', answers: ['Doc Brown','Dr. Grant','Dr. Lecter','Dr. Strange'], correct: 0, explanation: 'Emmett “Doc” Brown construit la DeLorean qui permet de voyager dans le temps.' }
];

function buildRecommendationEmbed(genre, mood) {
  const candidates = MOVIE_LIBRARY.filter(movie =>
    (genre === 'tous' || movie.genres.includes(genre)) &&
    (mood === 'surprise' || movie.moods.includes(mood))
  );
  const pool = candidates.length ? candidates : MOVIE_LIBRARY.filter(movie => genre === 'tous' || movie.genres.includes(genre));
  const movie = pool[Math.floor(Math.random() * pool.length)];
  const moodNames = { detente: 'Détente', frissons: 'Frissons', evasion: 'Évasion', emotion: 'Émotion', reflexion: 'Réflexion', surprise: 'Surprise' };
  const genreNames = { tous: 'Tous les genres', aventure: 'Aventure', animation: 'Animation', comedie: 'Comédie', drame: 'Drame', 'science-fiction': 'Science-fiction', thriller: 'Thriller' };
  return {
    author: { name: 'CINÉBOX  /  SÉLECTION DU CLUB' },
    title: '🎬  ' + movie.title,
    description: movie.synopsis + '\n\n**Pourquoi le regarder ?**\n' + movie.pitch,
    color: 0xd8b45a,
    fields: [
      { name: '📅  ANNÉE', value: String(movie.year), inline: true },
      { name: '⏱️  DURÉE', value: movie.duration + ' min', inline: true },
      { name: '🎭  GENRE', value: genreNames[genre] || 'Tous les genres', inline: true },
      { name: '✨  AMBIANCE', value: moodNames[mood] || 'Surprise', inline: true },
      { name: '🎟️  LE CONSEIL CINÉBOX', value: 'Installe-toi, prépare le pop-corn et profite de la séance.', inline: false }
    ],
    footer: { text: 'CINÉBOX  •  TA PROCHAINE PÉPITE  •  🍿  |  Une autre suggestion ?' },
    timestamp: new Date().toISOString()
  };
}

function buildRecommendationComponents(genre, mood) {
  return [{ type: 1, components: [{
    type: 2, style: 2, custom_id: 'cine_reco_again_' + genre + '_' + mood, label: '🎲  Une autre pépite'
  }] }];
}

function handleCinemaComponent(interaction, res) {
  const customId = interaction.data && interaction.data.custom_id || '';
  if (customId === 'cinebox_reset_cancel') return res.status(200).json({ type: 4, data: { content: 'Remise à zéro annulée. Aucun salon ni rôle n’a été supprimé.', flags: EPHEMERAL } });
  if (customId === 'cinebox_reset_confirm') return handleCineboxReset(interaction, res);
  const recoMatch = /^cine_reco_again_(tous|aventure|animation|comedie|drame|science-fiction|thriller)_(detente|frissons|evasion|emotion|reflexion|surprise)$/.exec(customId);
  if (recoMatch) return res.status(200).json({ type: 7, data: { embeds: [buildRecommendationEmbed(recoMatch[1], recoMatch[2])], components: buildRecommendationComponents(recoMatch[1], recoMatch[2]) } });
  if (customId.startsWith('cine_quiz_')) return handleCinemaQuiz(interaction, res);
  return handleCinemaVote(interaction, res);
}


async function handleCineboxReset(interaction, res) {
  if (!hasPermission(interaction.member?.permissions, PERM.ADMIN)) {
    return res.status(200).json({ type: 4, data: { content: 'Seuls les administrateurs peuvent confirmer cette action.', flags: EPHEMERAL } });
  }
  res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
  const task = (async () => {
    const guildId = interaction.guild_id;
    const managedCategories = [
      '01 • LE GRAND ÉCRAN', '02 • LE FOYER DES CINÉPHILES',
      '03 • LE CLUB VIP', '04 • ASSISTANCE & AMÉLIORATIONS',
      '05 • LES COULISSES (PRIVÉ)', '06 • SALONS VOCAUX'
    ];
    const managedChannels = [
      '👋•bienvenue','📢•actualités-cinébox','📜•règlement','✨•découvrir-cinébox',
      '💬•le-salon','🎞️•discussions-films','📺•discussions-séries','🍿•soirée-cinéma',
      '❤️•coups-de-cœur','🔎•que-regarder','🌟•espace-vip','🏆•membres-à-la-une',
      '🎁•surprises','🆘•besoin-daide','🐛•signaler-un-bug','💡•boîte-à-idées',
      '🚀•nouveautés-à-venir','👑•direction','🛡️•modération','📋・logs-bot','🧪•tests-cinébox',
      '📋•journal-équipe','🔊・Le Grand Salon','🔊・Séance privée','🔊・After Movie'
    ];
    const managedRoles = [
      '👑 Fondateur','💎 VIP CinéBox','🛡️ Modérateur','🎬 Cinéphile',
      '🍿 Nouveau membre','🤝 Ami de CinéBox','🌟 Ami fidèle','🎟️ Invité du ciné-club'
    ];
    try {
      console.log('CINEBOX_RESET_START', guildId);
      const channels = await discord('/guilds/' + guildId + '/channels');
      let deletedChannels = 0;
      for (const channel of channels.filter(item => managedChannels.includes(item.name))) {
        await discord('/channels/' + channel.id, { method: 'DELETE' });
        deletedChannels++;
        console.log('CINEBOX_RESET_CHANNEL_DELETED', channel.name);
      }
      let deletedCategories = 0;
      for (const category of channels.filter(item => item.type === 4 && managedCategories.includes(item.name))) {
        await discord('/channels/' + category.id, { method: 'DELETE' });
        deletedCategories++;
        console.log('CINEBOX_RESET_CATEGORY_DELETED', category.name);
      }
      const roles = await discord('/guilds/' + guildId + '/roles');
      let deletedRoles = 0;
      for (const role of roles.filter(item => managedRoles.includes(item.name))) {
        await discord('/guilds/' + guildId + '/roles/' + role.id, { method: 'DELETE' });
        deletedRoles++;
        console.log('CINEBOX_RESET_ROLE_DELETED', role.name);
      }
      console.log('CINEBOX_RESET_SUCCESS', { deletedChannels, deletedCategories, deletedRoles });
      await editOriginal(interaction, { content: '', embeds: [{ title: '🧹 Structure CinéBox supprimée', description: 'La remise à zéro est terminée.\n\n• ' + deletedChannels + ' salons supprimés\n• ' + deletedCategories + ' catégories supprimées\n• ' + deletedRoles + ' rôles supprimés\n\nLes autres éléments du serveur ont été conservés.', color: 0x57f287, footer: { text: 'CINÉBOX • REMISE À ZÉRO TERMINÉE' }, timestamp: new Date().toISOString() }] });
    } catch (error) {
      console.error('CINEBOX_RESET_FAILED', error && error.stack || error);
      await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Remise à zéro incomplète', description: 'Une erreur est survenue. Les éléments déjà supprimés le restent.\n\n' + String(error.message || error).slice(0, 700), color: 0xed4245, footer: { text: 'CINÉBOX • ASSISTANCE ADMINISTRATEUR' } }] });
    }
  })();
  waitUntil(task);
}
function buildQuizQuestionEmbed(questionIndex) {
  const question = CINEMA_QUIZ[questionIndex];
  return {
    author: { name: 'CINÉBOX  /  LE QUIZ DU CLUB' },
    title: '🎬 Question de culture cinéma',
    description: '**' + question.question + '**\n\n*Quatre propositions. Une seule bonne réponse. À toi de jouer !*',
    color: 0xd8b45a,
    footer: { text: 'CINÉBOX  •  QUIZ CINÉMA  •  QUESTION_' + questionIndex + '  •  🍿' },
    timestamp: new Date().toISOString()
  };
}

function buildQuizQuestionButtons(questionIndex) {
  const question = CINEMA_QUIZ[questionIndex];
  return {
    type: 1,
    components: question.answers.map((answer, index) => ({
      type: 2, style: 1,
      custom_id: 'cine_quiz_' + questionIndex + '_' + index + '_' + question.correct,
      label: String.fromCharCode(65 + index) + ' · ' + answer.slice(0, 70)
    }))
  };
}

function handleCinemaQuiz(interaction, res) {
  const customId = interaction.data.custom_id || '';
  if (customId === 'cine_quiz_next') {
    let nextIndex = Math.floor(Math.random() * CINEMA_QUIZ.length);
    const previousIndex = Number(interaction.message?.embeds?.[0]?.footer?.text?.match(/QUESTION_(\d+)/)?.[1]);
    if (CINEMA_QUIZ.length > 1 && nextIndex === previousIndex) nextIndex = (nextIndex + 1) % CINEMA_QUIZ.length;
    return res.status(200).json({ type: 7, data: { embeds: [buildQuizQuestionEmbed(nextIndex)], components: [buildQuizQuestionButtons(nextIndex)] } });
  }
  const match = /^cine_quiz_(\d+)_(\d+)_(\d+)$/.exec(customId);
  if (!match) return res.status(200).json({ type: 4, data: { content: 'Cette question n’est plus disponible.', flags: EPHEMERAL } });
  const questionIndex = Number(match[1]);
  const question = CINEMA_QUIZ[questionIndex];
  const selected = Number(match[2]);
  const correct = Number(match[3]);
  if (!question || selected < 0 || selected >= question.answers.length || correct !== question.correct) {
    return res.status(200).json({ type: 4, data: { content: 'Réponse invalide. Relance /quiz-cinema pour une nouvelle question.', flags: EPHEMERAL } });
  }
  const won = selected === correct;
  const buttons = question.answers.map((answer, index) => ({
    type: 2,
    style: index === correct ? 3 : index === selected ? 4 : 2,
    custom_id: 'cine_quiz_done_' + questionIndex + '_' + index,
    label: String.fromCharCode(65 + index) + ' · ' + answer.slice(0, 65) + (index === selected ? ' · TON CHOIX' : index === correct ? ' · BONNE RÉPONSE' : ''),
    disabled: true
  }));
  return res.status(200).json({
    type: 7,
    data: {
      embeds: [{
        author: { name: 'CINÉBOX  /  RÉSULTAT DU QUIZ' },
        title: won ? '🏆 BRAVO, CINÉPHILE !' : '🎬 BIEN TENTÉ !',
        description: (won ? '**Bonne réponse ! 1 / 1 point**' : '**Mauvaise réponse. 0 / 1 point**') + '\n\n**La bonne réponse :** ' + question.answers[correct] + '\n\n' + question.explanation,
        color: won ? 0x57f287 : 0xed4245,
        fields: [{ name: 'TON RÉSULTAT', value: won ? '🏆 1 / 1' : '🎬 0 / 1', inline: true }, { name: 'TA RÉPONSE', value: question.answers[selected], inline: true }],
        footer: { text: 'CINÉBOX  •  RÉPONSE VALIDÉE  •  🍿' },
        timestamp: new Date().toISOString()
      }],
      components: [{ type: 1, components: buttons }, { type: 1, components: [{ type: 2, style: 1, custom_id: 'cine_quiz_next', label: '🎲 Question suivante' }] }]
    }
  });
}

function parisDateTimeToDate(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const [year, month, day] = dm.slice(1).map(Number);
  const hour = Number(tm[1]), minute = Number(tm[2]);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(nominal);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let candidate = nominal;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
    const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    candidate = nominal - (localAsUtc - candidate);
  }
  const resolved = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
  if (Number(resolved.year) !== year || Number(resolved.month) !== month || Number(resolved.day) !== day || Number(resolved.hour) !== hour || Number(resolved.minute) !== minute) return null;
  return new Date(candidate);
}

function isValidDiscordSignature(rawBody, signature, timestamp, publicKey) {
  if (!signature || !timestamp || !publicKey) return false;
  if (!/^[0-9a-f]{128}$/i.test(signature) || !/^[0-9a-f]{64}$/i.test(publicKey)) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody.toString('utf8'), 'utf8'),
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex')
    );
  } catch (error) {
    console.error('Discord signature verification error:', error.message);
    return false;
  }
}

function reply(res, content) { return res.status(200).json({ type: 4, data: { content, flags: EPHEMERAL } }); }
function embedReply(res, embed) {
  const polished = Object.assign({
    author: { name: 'CINÉBOX  /  LE CLUB DES CINÉPHILES' },
    color: 0xd8b45a,
    footer: { text: 'CINÉBOX  •  LE CLUB DES CINÉPHILES  •  🍿' },
    timestamp: new Date().toISOString()
  }, embed || {});
  return res.status(200).json({ type: 4, data: { flags: EPHEMERAL, embeds: [polished] } });
}


// Messages automatiques de bienvenue et de départ (service Gateway Railway).
const CINEBOX_SITE = 'https://cinebox-a1h.pages.dev/';

function buildWelcomePayload(member, welcomeChannelId, memberCount) {
  const user = member.user || member;
  const tag = user.global_name || user.username || 'nouveau cinéphile';
  const count = Number(memberCount || 0);
  return {
    channel_id: welcomeChannelId,
    content: '🍿 **Un nouveau cinéphile rejoint la salle !**',
    embeds: [{
      author: { name: 'CINÉBOX  /  BIENVENUE AU CLUB' },
      title: '🎬 Bienvenue ' + tag + ' !',
      description: 'Installe-toi confortablement, la séance va commencer.\n\nTu viens de rejoindre **CinéBox**, le club des passionnés de films et de séries. Présente-toi, échange tes découvertes et trouve ton prochain coup de cœur.\n\n🌐 [Découvrir le site CinéBox](' + CINEBOX_SITE + ')',
      color: 0xd8b45a,
      thumbnail: { url: user.displayAvatarURL ? user.displayAvatarURL({ extension: 'png', size: 256 }) : undefined },
      fields: [
        { name: '🍿 PREMIERS PAS', value: '👋 Présente-toi dans <#WELCOME_CHANNEL_ID>\n📜 Lis le règlement\n💬 Rejoins les discussions cinéma', inline: false },
        { name: '🎟️ MEMBRE', value: count > 0 ? 'Tu es notre **' + count + (count === 1 ? 'er' : 'e') + ' cinéphile** !' : 'Bienvenue dans la communauté !', inline: true }
      ],
      footer: { text: 'CINÉBOX  •  LE CLUB DES CINÉPHILES  •  🍿' },
      timestamp: new Date().toISOString()
    }]
  };
}

function buildGoodbyePayload(member, goodbyeChannelId, memberCount) {
  const user = member.user || member;
  const tag = user.global_name || user.username || 'Un cinéphile';
  return {
    channel_id: goodbyeChannelId,
    content: '🌙 **Une place se libère dans notre salle…**',
    embeds: [{
      author: { name: 'CINÉBOX  /  À BIENTÔT' },
      title: '🎞️ ' + tag + ' quitte le ciné-club',
      description: 'Merci d’avoir partagé un bout de l’aventure **CinéBox** avec nous.\n\nLes portes du club te resteront toujours ouvertes. À une prochaine séance, et prends soin de toi ! 🍿\n\n🌐 [Retrouver CinéBox](' + CINEBOX_SITE + ')',
      color: 0x64748b,
      thumbnail: { url: user.displayAvatarURL ? user.displayAvatarURL({ extension: 'png', size: 256 }) : undefined },
      fields: [{ name: '👥 LA COMMUNAUTÉ', value: Number(memberCount || 0) > 0 ? 'Il reste **' + memberCount + ' membres** dans le club.' : 'La séance continue pour la communauté.', inline: true }],
      footer: { text: 'CINÉBOX  •  MERCI POUR TON PASSAGE  •  🍿' },
      timestamp: new Date().toISOString()
    }]
  };
}

// À appeler depuis le client Discord.js Gateway :
// client.on('guildMemberAdd', async member => { ... })
// client.on('guildMemberRemove', async member => { ... })
// Les identifiants de salons et le rôle sont configurables par variables d'environnement.
async function handleCineboxMemberJoin(member) {
  const guild = member.guild;
  const welcomeChannel = process.env.WELCOME_CHANNEL_ID;
  const roleId = process.env.NEW_MEMBER_ROLE_ID;
  if (roleId) {
    try { await member.roles.add(roleId, 'Bienvenue dans le club CinéBox'); }
    catch (error) { console.error('WELCOME_ROLE_FAILED', error); }
  }
  if (!welcomeChannel) return;
  const channel = guild.channels.cache.get(welcomeChannel);
  if (!channel || !channel.isTextBased()) return;
  const payload = buildWelcomePayload(member, welcomeChannel, guild.memberCount);
  const embed = payload.embeds[0];
  embed.description = embed.description.replace('<#WELCOME_CHANNEL_ID>', process.env.INTRO_CHANNEL_ID ? '<#' + process.env.INTRO_CHANNEL_ID + '>' : 'le salon de présentation')
    .replace('Lis le règlement', process.env.RULES_CHANNEL_ID ? 'Lis le règlement dans <#' + process.env.RULES_CHANNEL_ID + '>' : 'Lis le règlement du serveur');
  delete embed.thumbnail?.url;
  if (member.user.displayAvatarURL) embed.thumbnail = { url: member.user.displayAvatarURL({ extension: 'png', size: 256 }) };
  await channel.send({ content: payload.content, embeds: [embed] });
}

async function handleCineboxMemberLeave(member) {
  const goodbyeChannel = process.env.GOODBYE_CHANNEL_ID || process.env.WELCOME_CHANNEL_ID;
  if (!goodbyeChannel) return;
  const channel = member.guild.channels.cache.get(goodbyeChannel);
  if (!channel || !channel.isTextBased()) return;
  const payload = buildGoodbyePayload(member, goodbyeChannel, member.guild.memberCount);
  const embed = payload.embeds[0];
  if (member.user.displayAvatarURL) embed.thumbnail = { url: member.user.displayAvatarURL({ extension: 'png', size: 256 }) };
  await channel.send({ content: payload.content, embeds: [embed] });
}

async function setupGuild(guildId, onProgress) {
  const defs = [
    { name: '👑 Fondateur', color: 0xf1c75b, hoist: true },
    { name: '💎 VIP CinéBox', color: 0xd8b4fe, hoist: true },
    { name: '🛡️ Modérateur', color: 0x60a5fa, hoist: true },
    { name: '🎬 Cinéphile', color: 0xe5c76b, hoist: false },
    { name: '🍿 Nouveau membre', color: 0x9ca3af, hoist: false },
    { name: '🤝 Ami de CinéBox', color: 0x78c6a3, hoist: false },
    { name: '🌟 Ami fidèle', color: 0xf4a7c4, hoist: false },
    { name: '🎟️ Invité du ciné-club', color: 0x8bb8e8, hoist: false }
  ];
  const groups = [
    { name: '01 • LE GRAND ÉCRAN', channels: [['👋•bienvenue','Bienvenue au club ! Présente-toi et découvre la communauté.'],['📢•actualités-cinébox','Les annonces et actualités officielles de CinéBox.'],['📜•règlement','Les règles pour que tout le monde profite du serveur.'],['✨•découvrir-cinébox','Découvre CinéBox et les liens utiles.']] },
    { name: '02 • LE FOYER DES CINÉPHILES', channels: [['💬•le-salon','Le salon général de la communauté.'],['🎞️•discussions-films','Parlons cinéma et dernières sorties.'],['📺•discussions-séries','Vos séries du moment et vos théories.'],['🍿•soirée-cinéma','Organisons les prochaines soirées cinéma.'],['❤️•coups-de-cœur','Vos pépites et coups de cœur.'],['🔎•que-regarder','Besoin d’une recommandation ? Demande ici.']] },
    { name: '03 • LE CLUB VIP', channels: [['🌟•espace-vip','Un espace réservé aux membres VIP et à l’équipe.'],['🏆•membres-à-la-une','Les membres et contributions à l’honneur.'],['🎁•surprises','Surprises et événements spéciaux.']] },
    { name: '04 • ASSISTANCE & AMÉLIORATIONS', channels: [['🆘•besoin-daide','Une question ? La communauté et l’équipe sont là.'],['🐛•signaler-un-bug','Utilise /signaler pour transmettre un problème.'],['💡•boîte-à-idées','Utilise /suggestion pour proposer une idée.'],['🚀•nouveautés-à-venir','Les nouveautés et améliorations à venir.']] },
    { name: '05 • LES COULISSES (PRIVÉ)', private: true, channels: [['👑•direction','Espace privé de direction.'],['🛡️•modération','Coordination de la modération.'],['📋・logs-bot','Journal automatique des commandes, interactions et événements CinéBox.'], ['🧪•tests-cinébox','Tests internes du serveur et du site.'],['📋•journal-équipe','Suivi des actions de l’équipe.']] }
  ];
  const voiceNames = ['🔊・Le Grand Salon', '🔊・Séance privée', '🔊・After Movie'];
  const total = defs.length + groups.reduce((n, g) => n + 1 + g.channels.length, 0) + 1 + voiceNames.length + 2;
  let done = 0, createdCount = 0, checked = 0, lastUpdate = 0;
  const progress = async (phase, label, wasCreated) => {
    done++;
    if (wasCreated) createdCount++; else checked++;
    const now = Date.now();
    if (onProgress && (done === 1 || done === total || now - lastUpdate >= 900)) {
      lastUpdate = now;
      await onProgress({ done, total, phase, label, created: createdCount, checked });
    }
  };
  if (onProgress) await onProgress({ done: 0, total, phase: 'Connexion', label: 'Lecture des rôles et salons existants', created: 0, checked: 0 });
  console.log('SETUP_FETCH_ROLES_CHANNELS_START');
  const [roles, channels] = await Promise.all([
    discord('/guilds/' + guildId + '/roles'),
    discord('/guilds/' + guildId + '/channels')
  ]);
  console.log('SETUP_FETCH_ROLES_CHANNELS_OK', { roles: roles.length, channels: channels.length });
  const created = [];
  const roleIds = {};
  for (const def of defs) {
    let role = roles.find(r => r.name === def.name);
    let wasCreated = false;
    if (!role) {
      role = await discord('/guilds/' + guildId + '/roles', { method: 'POST', body: { name: def.name, color: def.color, hoist: def.hoist, mentionable: false } });
      roles.push(role); created.push('Rôle ' + def.name); wasCreated = true;
    }
    roleIds[def.name] = role.id;
    await progress('Rôles', def.name, wasCreated);
  }
  const staff = [
    { id: guildId, type: 0, deny: PERM.VIEW },
    { id: roleIds['👑 Fondateur'], type: 0, allow: bitset(PERM.VIEW, PERM.SEND, PERM.HISTORY, PERM.MANAGE_MESSAGES) },
    { id: roleIds['🛡️ Modérateur'], type: 0, allow: bitset(PERM.VIEW, PERM.SEND, PERM.HISTORY, PERM.MANAGE_MESSAGES) }
  ];
  const vip = [
    { id: guildId, type: 0, deny: PERM.VIEW },
    { id: roleIds['💎 VIP CinéBox'], type: 0, allow: bitset(PERM.VIEW, PERM.SEND, PERM.HISTORY) },
    { id: roleIds['👑 Fondateur'], type: 0, allow: bitset(PERM.VIEW, PERM.SEND, PERM.HISTORY) },
    { id: roleIds['🛡️ Modérateur'], type: 0, allow: bitset(PERM.VIEW, PERM.SEND, PERM.HISTORY, PERM.MANAGE_MESSAGES) }
  ];
  async function getOrCreate(name, type, parentId, extra) {
    extra = extra || {};
    let channel = channels.find(c => c.name === name && c.type === type);
    if (!channel && type === 0 && name.includes('•')) {
      const legacyName = name.replace('•', '-');
      channel = channels.find(c => c.name === legacyName && c.type === type);
      if (channel) {
        const renamed = await discord('/channels/' + channel.id, { method: 'PATCH', body: { name } });
        Object.assign(channel, renamed);
        console.log('CINEBOX_CHANNEL_RENAMED', legacyName, '->', name);
      }
    }
    let wasCreated = false;
    if (!channel) {
      const body = Object.assign({ name, type }, extra);
      if (parentId) body.parent_id = parentId;
      channel = await discord('/guilds/' + guildId + '/channels', { method: 'POST', body });
      channels.push(channel);
      created.push((type === 4 ? 'Catégorie ' : type === 2 ? 'Vocal ' : '#') + name);
      wasCreated = true;
    } else {
      const patch = {};
      if (parentId && channel.parent_id !== parentId) patch.parent_id = parentId;
      if (extra.topic && channel.topic !== extra.topic) patch.topic = extra.topic;
      if (extra.permission_overwrites) patch.permission_overwrites = extra.permission_overwrites;
      if (Object.keys(patch).length) {
        const updated = await discord('/channels/' + channel.id, { method: 'PATCH', body: patch });
        Object.assign(channel, updated);
      }
    }
    await progress(type === 4 ? 'Catégories' : type === 2 ? 'Salons vocaux' : 'Salons texte', name, wasCreated);
    return channel;
  }
  const textMap = {};
  for (const group of groups) {
    const category = await getOrCreate(group.name, 4, null, group.private ? { permission_overwrites: staff } : {});
    for (const [channelName, topic] of group.channels) {
      const overwrites = group.private ? staff : channelName === '🌟•espace-vip' ? vip : undefined;
      const extra = { topic };
      if (overwrites) extra.permission_overwrites = overwrites;
      textMap[channelName] = await getOrCreate(channelName, 0, category.id, extra);
    }
  }
  const voiceCategory = await getOrCreate('06 • SALONS VOCAUX', 4, null, {});
  for (const name of voiceNames) await getOrCreate(name, 2, voiceCategory.id, {});
  const rules = textMap['📜•règlement'];
  if (rules && !(rules.topic || '').includes('[CINEBOX_RULES]')) {
    await discord('/channels/' + rules.id + '/messages', { method: 'POST', body: { content: '🎬 **Bienvenue au Club des Cinéphiles CinéBox !**\n\n1. Respecte chaque membre.\n2. Aucun harcèlement, discrimination ou insultes.\n3. Pas de spam ni de publicité non autorisée.\n4. Utilise les salons adaptés aux discussions.\n5. Attention aux spoilers : préviens et masque-les.\n6. Respecte les décisions de la modération.\n\nEn restant sur le serveur, tu acceptes ces règles. Bon visionnage ! 🍿' } });
    await discord('/channels/' + rules.id, { method: 'PATCH', body: { topic: '[CINEBOX_RULES] Règlement officiel du serveur.' } });
  }
  await progress('Finalisation', 'Règlement', false);
  const discover = textMap['✨•découvrir-cinébox'];
  if (discover && !(discover.topic || '').includes('[CINEBOX_DISCOVER]')) {
    const welcomeId = textMap['👋•bienvenue'].id, newsId = textMap['📢•actualités-cinébox'].id, helpId = textMap['🆘•besoin-daide'].id;
    const content = '✨ **Bienvenue sur CinéBox !**\n\nRetrouve ici la communauté des passionnés de films et de séries. Présente-toi dans <#' + welcomeId + '>, échange dans les salons thématiques et partage tes recommandations.\n\n📢 Les annonces officielles sont publiées dans <#' + newsId + '>.\n🆘 Besoin d’aide ? Rendez-vous dans <#' + helpId + '>.\n\n**Installe-toi, la séance commence !** 🍿';
    await discord('/channels/' + discover.id + '/messages', { method: 'POST', body: { content } });
    await discord('/channels/' + discover.id, { method: 'PATCH', body: { topic: '[CINEBOX_DISCOVER] Présentation et liens utiles.' } });
  }
  await progress('Finalisation', 'Message de présentation', false);
  return { created, roles: defs.length, textChannels: Object.keys(textMap).length, voiceChannels: voiceNames.length };
}

async function logBotEvent(guildId, title, detail, interaction) {
  try {
    const channels = await discord('/guilds/' + guildId + '/channels');
    const channel = channels.find(item => item.name === '📋・logs-bot' && item.type === 0);
    if (!channel) return;
    const user = interaction?.member?.user || interaction?.user || {};
    const username = user.global_name || user.username || 'Utilisateur inconnu';
    await discord('/channels/' + channel.id + '/messages', { method: 'POST', body: { embeds: [{
      author: { name: 'CINÉBOX  /  JOURNAL DU BOT' },
      title: String(title).slice(0, 250),
      description: String(detail || 'Événement sans détail').slice(0, 900),
      color: 0xd8b45a,
      fields: [
        { name: 'Membre', value: username + (user.id ? ' (ID : ' + user.id + ')' : ''), inline: true },
        { name: 'Salon', value: interaction?.channel_id ? '<#' + interaction.channel_id + '>' : 'Non disponible', inline: true }
      ],
      footer: { text: 'CINÉBOX  •  LOG AUTOMATIQUE' },
      timestamp: new Date().toISOString()
    }] } });
  } catch (error) { console.error('CINEBOX_BOT_LOG_FAILED', error?.stack || error); }
}

async function discord(path, options) {
  options = options || {};
  const method = options.method || 'GET';
  const maxAttempts = method === 'GET' || method === 'PATCH' ? 4 : 2;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    console.log('DISCORD_API_START', method, path, 'attempt', attempt);
    try {
      const response = await fetch(API + path, {
        method,
        headers: Object.assign({ Authorization: 'Bot ' + process.env.DISCORD_TOKEN }, options.body ? { 'Content-Type': 'application/json' } : {}),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(12000)
      });
      console.log('DISCORD_API_RESPONSE', method, path, response.status, Date.now() - started + 'ms');
      if (response.status === 429) {
        const raw = await response.text();
        let retryAfter = Number(response.headers.get('retry-after') || 0);
        try {
          const data = JSON.parse(raw);
          retryAfter = Number(data.retry_after || retryAfter || 1);
        } catch {}
        // Cloudflare can return an HTML 1015 page instead of Discord's JSON rate-limit body.
        if (!retryAfter || /error 1015|you are being rate limited/i.test(raw)) retryAfter = Math.min(30, 2 ** attempt * 2);
        if (attempt === maxAttempts) throw new Error('Discord/Cloudflare limite temporairement les requêtes (HTTP 429). Réessaie dans une à deux minutes.');
        const delay = Math.min(30000, Math.max(1500, retryAfter * 1000 + 500));
        console.warn('DISCORD_RATE_LIMIT_WAIT', method, path, delay + 'ms');
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const raw = response.status === 204 ? '' : await response.text();
      if (!response.ok) throw new Error('Discord API ' + response.status + ': ' + raw.slice(0, 500));
      if (!raw) return null;
      try { return JSON.parse(raw); }
      catch { throw new Error('Discord API a renvoyé une réponse non JSON (HTTP ' + response.status + ').'); }
    } catch (error) {
      lastError = error;
      console.error('DISCORD_API_ERROR', method, path, 'attempt', attempt, Date.now() - started + 'ms', error && error.message || error);
      const transient = error instanceof TypeError || error.name === 'TimeoutError' || /UND_ERR_SOCKET|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(error));
      if (!transient || attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function editOriginal(interaction, content) {
  const url = API + '/webhooks/' + interaction.application_id + '/' + interaction.token + '/messages/@original';
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof content === 'string' ? { content } : content),
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) console.error('SETUP_EDIT_FAILED', response.status, await response.text());
    else console.log('SETUP_EDIT_OK');
  } catch (error) {
    console.error('SETUP_EDIT_NETWORK_ERROR', error && error.message || error);
  }
}
function bitset() { return String(Array.from(arguments).reduce((sum, value) => sum | BigInt(value), 0n)); }
function hasPermission(value, permission) {
  try { return (BigInt(value || '0') & permission) === permission; } catch { return false; }
}
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

module.exports.config = { api: { bodyParser: false } };

module.exports.handleCineboxMemberJoin = handleCineboxMemberJoin;
module.exports.handleCineboxMemberLeave = handleCineboxMemberLeave;
