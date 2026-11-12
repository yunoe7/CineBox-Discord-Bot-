require('dotenv').config();
const { createServer } = require('node:http');
const interactionHandler = require('../api/discord');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, PermissionsBitField } = require('discord.js');

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN est requis pour le service Gateway CinéBox.');

const SITE_URL = 'https://cinebox-a1h.pages.dev/';
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});

function getTextChannel(guild, id, fallbackName) {
  return (id && guild.channels.cache.get(id)) ||
    guild.channels.cache.find(channel => channel.isTextBased() && channel.name === fallbackName) ||
    null;
}

async function sendBotLog(guild, title, description, color = 0xd8b45a) {
  try {
    const channel = guild.channels.cache.find(item => item.isTextBased() && item.name === '📋・logs-bot');
    if (!channel) return;
    await channel.send({ embeds: [{
      author: { name: 'CINÉBOX  /  JOURNAL DU BOT' },
      title,
      description: String(description || 'Aucun détail').slice(0, 900),
      color,
      footer: { text: 'CINÉBOX  •  LOG AUTOMATIQUE' },
      timestamp: new Date()
    }] });
  } catch (error) {
    console.error('CINEBOX_BOT_LOG_SEND_FAILED', error?.stack || error);
  }
}

client.once('clientReady', () => {
  console.log('CINEBOX_GATEWAY_READY ' + client.user.tag);
  for (const guild of client.guilds.cache.values()) void sendBotLog(guild, '🟢 Bot démarré', 'CinéBox est connecté à Discord.');
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'CinéBox 🍿 • cinebox-a1h.pages.dev', type: ActivityType.Playing }]
  });
});


// Anti-spam souple : détection de rafales sans lire le contenu des messages.
const antiSpamWindows = new Map();
const antiSpamCooldowns = new Map();
const ANTISPAM_WINDOW_MS = 7000;
const ANTISPAM_MAX_MESSAGES = 6;
const ANTISPAM_COOLDOWN_MS = 15000;

client.on('messageCreate', async message => {
  if (!message.guild || !message.author || message.author.bot || message.webhookId) return;

  const permissions = message.member?.permissions;
  if (permissions?.has(PermissionsBitField.Flags.Administrator) ||
      permissions?.has(PermissionsBitField.Flags.ManageMessages)) return;

  const now = Date.now();
  const key = message.guild.id + ':' + message.author.id;
  const timestamps = (antiSpamWindows.get(key) || []).filter(time => now - time <= ANTISPAM_WINDOW_MS);
  timestamps.push(now);
  antiSpamWindows.set(key, timestamps);

  // Évite une croissance illimitée des compteurs si de nombreux comptes passent.
  if (antiSpamWindows.size > 5000) {
    for (const [entryKey, entryTimes] of antiSpamWindows) {
      if (!entryTimes.length || now - entryTimes[entryTimes.length - 1] > ANTISPAM_WINDOW_MS) {
        antiSpamWindows.delete(entryKey);
        antiSpamCooldowns.delete(entryKey);
      }
    }
  }

  if (timestamps.length <= ANTISPAM_MAX_MESSAGES) return;
  const lastAction = antiSpamCooldowns.get(key) || 0;
  if (now - lastAction < ANTISPAM_COOLDOWN_MS) return;
  antiSpamCooldowns.set(key, now);

  try {
    await message.delete();
    console.warn('CINEBOX_ANTISPAM_MESSAGE_DELETED', {
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channel.id,
      messagesInWindow: timestamps.length
    });
    void sendBotLog(
      message.guild,
      '🚨 Anti-spam : message supprimé',
      '**Membre :** <@' + message.author.id + '>\\n' +
      '**Salon :** <#' + message.channel.id + '>\\n' +
      '**Détection :** ' + timestamps.length + ' messages en 7 secondes\\n' +
      '**Action :** dernier message supprimé, aucune sanction automatique.',
      0xed4245
    );
  } catch (error) {
    console.error('CINEBOX_ANTISPAM_DELETE_FAILED', {
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channel.id,
      error: error?.stack || error
    });
    void sendBotLog(
      message.guild,
      '⚠️ Anti-spam : suppression impossible',
      'Détection pour <@' + message.author.id + '> dans <#' + message.channel.id + '>, mais Discord a refusé la suppression. Vérifie la permission **Gérer les messages** du bot.',
      0xed4245
    );
  }
});

async function readWelcomeConfig(guild) {
  try {
    // Force a fresh read: setup/configuration may have changed after the bot started.
    const configChannel = await guild.channels.fetch().then(channels =>
      channels.find(channel => channel.name === '📋•journal-équipe' && channel.isTextBased()) || null
    );
    if (!configChannel) {
      console.warn('CINEBOX_WELCOME_CONFIG_CHANNEL_MISSING', guild.id);
      return null;
    }
    const fresh = await configChannel.fetch(true);
    const topic = fresh.topic || '';
    const marker = 'CINEBOX_WELCOME_CONFIG:';
    const index = topic.indexOf(marker);
    if (index === -1) {
      console.warn('CINEBOX_WELCOME_CONFIG_NOT_SET', guild.id);
      return null;
    }
    const raw = topic.slice(index + marker.length).trim();
    const match = raw.match(/^(\{.*\})$/);
    if (!match) {
      console.error('CINEBOX_WELCOME_CONFIG_INVALID_FORMAT', guild.id);
      return null;
    }
    const config = JSON.parse(match[1]);
    console.log('CINEBOX_WELCOME_CONFIG_LOADED', guild.id, {
      welcomeEnabled: Boolean(config.welcomeEnabled),
      welcomeChannelConfigured: Boolean(config.welcomeChannelId),
      goodbyeEnabled: Boolean(config.goodbyeEnabled),
      autoRoleEnabled: Boolean(config.autoRoleEnabled)
    });
    return config;
  } catch (error) {
    console.error('CINEBOX_WELCOME_CONFIG_READ_FAILED', error?.stack || error);
    return null;
  }
}

client.on('guildMemberAdd', async member => {
  console.log('CINEBOX_MEMBER_JOIN ' + member.user.id);
  void sendBotLog(member.guild, '👋 Nouveau membre', '**' + (member.user.tag || member.user.username) + '** a rejoint le serveur.\nID : ' + member.id);
  try {
    const config = await readWelcomeConfig(member.guild);
    if (!config) {
      console.warn('CINEBOX_WELCOME_SKIPPED_NO_CONFIG', member.guild.id);
      return;
    }
    if (config.autoRoleEnabled && config.newMemberRoleId) {
      const role = await member.guild.roles.fetch(config.newMemberRoleId).catch(error => {
        console.error('CINEBOX_WELCOME_ROLE_FETCH_FAILED', error?.message || error);
        return null;
      });
      if (role) {
        await member.roles.add(role, 'Rôle automatique configuré par un administrateur CinéBox');
        console.log('CINEBOX_WELCOME_ROLE_ASSIGNED', member.id, role.id);
      } else {
        console.warn('CINEBOX_WELCOME_ROLE_NOT_FOUND', config.newMemberRoleId);
      }
    }
    if (!config.welcomeEnabled) {
      console.warn('CINEBOX_WELCOME_DISABLED', member.guild.id);
      return;
    }
    if (!config.welcomeChannelId) {
      console.warn('CINEBOX_WELCOME_CHANNEL_NOT_CONFIGURED', member.guild.id);
      return;
    }
    const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(error => {
      console.error('CINEBOX_WELCOME_CHANNEL_FETCH_FAILED', config.welcomeChannelId, error?.message || error);
      return null;
    });
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
      console.error('CINEBOX_WELCOME_CHANNEL_UNAVAILABLE', config.welcomeChannelId);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xd8b45a)
      .setAuthor({ name: 'CINÉBOX  /  BIENVENUE AU CLUB' })
      .setTitle('🎬 Bienvenue ' + (member.user.globalName || member.user.username) + ' !')
      .setDescription(
        'Installe-toi confortablement, la séance va commencer. 🍿\n\n' +
        'Tu rejoins **CinéBox**, le club des passionnés de films et de séries. ' +
        'Présente-toi et découvre les salons du serveur.\n\n' +
        '🌐 [Découvrir le site CinéBox](' + SITE_URL + ')'
      )
      .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '🎟️ TON PASS', value: 'Membre **n°' + member.guild.memberCount + '** du club', inline: true },
        { name: '🍿 À TOI DE JOUER', value: 'Dis-nous quel film tu pourrais revoir 100 fois !', inline: true }
      )
      .setFooter({ text: 'CINÉBOX  •  LE CLUB DES CINÉPHILES  •  🍿' })
      .setTimestamp();
    const sent = await channel.send({ content: '✨ <@' + member.id + '> rejoint le ciné-club !', embeds: [embed] });
    console.log('CINEBOX_WELCOME_SENT', member.id, channel.id, sent.id);
  } catch (error) {
    console.error('CINEBOX_WELCOME_ERROR', member.id, error?.stack || error);
    void sendBotLog(member.guild, '⚠️ Échec du message de bienvenue',
      'Impossible de publier le message pour <@' + member.id + '>. Vérifie les permissions du bot dans le salon de bienvenue.\\n' +
      String(error?.message || error).slice(0, 700), 0xed4245);
  }
});

client.on('guildMemberRemove', async member => {
  console.log('CINEBOX_MEMBER_LEAVE ' + member.user.id);
  void sendBotLog(member.guild, '🌙 Départ d’un membre', '**' + (member.user.tag || member.user.username) + '** a quitté le serveur.\nID : ' + member.id, 0x64748b);
  try {
    const config = await readWelcomeConfig(member.guild);
    if (!config || !config.goodbyeEnabled || !config.goodbyeChannelId) return;
    const channel = await member.guild.channels.fetch(config.goodbyeChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setColor(0x64748b)
      .setAuthor({ name: 'CINÉBOX  /  À BIENTÔT' })
      .setTitle('🌙 Une place se libère dans la salle…')
      .setDescription(
        '**' + member.user.username + '** quitte le club.\\n\\n' +
        'Merci d’avoir partagé un bout de l’aventure CinéBox avec nous. ' +
        'Les portes du ciné-club te resteront ouvertes. À une prochaine séance ! 🍿\\n\\n' +
        '🌐 [Retrouver CinéBox](' + SITE_URL + ')'
      )
      .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields({ name: '👥 COMMUNAUTÉ', value: 'Il reste **' + member.guild.memberCount + ' membres** dans le club.', inline: true })
      .setFooter({ text: 'CINÉBOX  •  MERCI POUR TON PASSAGE  •  🍿' })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('CINEBOX_GOODBYE_ERROR', error);
  }
});

const interactionServer = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/interactions') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }
  const response = {
    status(code) { res.statusCode = code; return this; },
    setHeader(name, value) { res.setHeader(name, value); },
    json(payload) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    },
    send(payload) { res.end(payload); }
  };
  interactionHandler(req, response).catch(error => {
    console.error('CINEBOX_INTERACTION_ERROR', error && error.stack || error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    if (!res.writableEnded) res.end('Internal Server Error');
  });
});
interactionServer.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('CINEBOX_INTERACTIONS_HTTP_READY port=' + (process.env.PORT || 3000));
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error('CINEBOX_GATEWAY_LOGIN_FAILED', error);
  process.exit(1);
});
