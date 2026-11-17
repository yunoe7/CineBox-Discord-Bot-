require('dotenv').config();
const { createServer } = require('node:http');
const interactionHandler = require('../api/discord');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, PermissionsBitField } = require('discord.js');

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN est requis pour le service Gateway CinéBox.');

const SITE_URL = (process.env.MOVIX_SITE_URL || 'https://movix.miami').replace(/\/+$/, '') + '/';
const MOVIX_API_URL = (process.env.MOVIX_API_URL || SITE_URL).replace(/\/+$/, '');
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});

function getTextChannel(guild, id, fallbackName) {
  return (id && guild.channels.cache.get(id)) ||
    guild.channels.cache.find(channel => channel.isTextBased() && channel.name === fallbackName) ||
    null;
}

function getLogStyle(title, fallbackColor = 0xd8b45a) {
  const value = String(title || '').toLowerCase();
  if (/anti-spam|anti-raid|suspect|sécurité|erreur|impossible|échec|failed/.test(value)) return { color: 0xed4245, category: 'SÉCURITÉ' };
  if (/avertissement|timeout|expuls|banni|modération|sanction|clôtur/.test(value)) return { color: 0xe67e22, category: 'MODÉRATION' };
  if (/membre|rejoint|quitt|bienvenue|départ/.test(value)) return { color: 0x3498db, category: 'COMMUNAUTÉ' };
  if (/sondage|vote|cinéma|film|tirage/.test(value)) return { color: 0x9b59b6, category: 'CINÉMA' };
  if (/démarr|connect|redémarr|en ligne/.test(value)) return { color: 0x2ecc71, category: 'SYSTÈME' };
  return { color: fallbackColor, category: 'ACTIVITÉ' };
}

async function sendBotLog(guild, title, description, color = 0xd8b45a) {
  try {
    const channel = guild.channels.cache.find(item => item.isTextBased() && item.name === '📋・logs-bot');
    if (!channel) return;
    const style = getLogStyle(title, color);
    const detail = String(description || 'Aucun détail supplémentaire.')
      .replace(/\r\n/g, '\n').replace(/\n/g, '\n').replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n').trim().slice(0, 3000);
    await channel.send({
      embeds: [{
        author: { name: '🍿  CINÉBOX  •  JOURNAL DU BOT', icon_url: client.user.displayAvatarURL() },
        title: String(title || 'Événement du bot').slice(0, 240),
        description: detail || 'Aucun détail supplémentaire.',
        color: style.color,
        fields: [
          { name: '🏷️ Catégorie', value: style.category, inline: true },
          { name: '📍 Serveur', value: String(guild.name || 'Serveur inconnu').slice(0, 100), inline: true },
          { name: '🧾 Type', value: 'Événement automatique', inline: true }
        ],
        footer: { text: 'CINÉBOX  •  JOURNAL SYSTÈME' },
        timestamp: new Date().toISOString()
      }],
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }
    });
  } catch (error) {
    console.error('CINEBOX_BOT_LOG_SEND_FAILED', error?.stack || error);
  }
}

const VIP_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let vipSyncRunning = false;

async function syncVipRoles() {
  const roleId = process.env.VIP_ROLE_ID;
  const secret = process.env.MOVIX_DISCORD_SYNC_SECRET;
  if (!roleId || !secret || vipSyncRunning) return;
  vipSyncRunning = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        console.warn('CINEBOX_VIP_ROLE_NOT_FOUND', guild.id);
        continue;
      }
      const members = await guild.members.fetch();
      let checked = 0;
      for (const member of members.values()) {
        if (member.user.bot) continue;
        try {
          const response = await fetch(MOVIX_API_URL + '/api/internal/discord/member', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
            body: JSON.stringify({ discordUserId: member.id }),
            signal: AbortSignal.timeout(7000)
          });
          if (!response.ok) throw new Error('Movix API HTTP ' + response.status);
          const result = await response.json();
          if (result?.success !== true || typeof result.linked !== 'boolean' || typeof result.vip?.active !== 'boolean') {
            throw new Error('Réponse VIP Movix invalide — rôle conservé par sécurité');
          }
          const shouldHaveRole = result.linked && result.vip.active;
          const hasRole = member.roles.cache.has(roleId);
          if (shouldHaveRole && !hasRole) await member.roles.add(roleId, 'Statut VIP Movix actif');
          else if (!shouldHaveRole && hasRole) await member.roles.remove(roleId, 'Statut VIP Movix absent ou expiré');
          checked++;
        } catch (error) {
          console.error('CINEBOX_VIP_MEMBER_SYNC_FAILED', member.id, error?.message || error);
        }
      }
      console.log('CINEBOX_VIP_SYNC_COMPLETE', guild.id, { checked });
    }
  } catch (error) {
    console.error('CINEBOX_VIP_SYNC_FAILED', error?.stack || error);
  } finally {
    vipSyncRunning = false;
  }
}

client.once('clientReady', () => {
  console.log('CINEBOX_GATEWAY_READY ' + client.user.tag);
  for (const guild of client.guilds.cache.values()) void sendBotLog(guild, '🟢 Bot démarré', 'CinéBox est connecté à Discord.');
  void syncVipRoles();
  setInterval(() => void syncVipRoles(), VIP_SYNC_INTERVAL_MS).unref();
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'CinéBox 🍿 • cinebox-a1h.pages.dev', type: ActivityType.Playing }]
  });
});


// Anti-spam souple : rafales, répétitions et liens potentiellement suspects.
const antiSpamWindows = new Map();
const antiSpamCooldowns = new Map();
const repeatedContentWindows = new Map();
const ANTISPAM_WINDOW_MS = 7000;
const ANTISPAM_MAX_MESSAGES = 6;
const ANTISPAM_COOLDOWN_MS = 15000;
const REPEAT_WINDOW_MS = 15000;
const REPEAT_MAX_MESSAGES = 3;
const SUSPICIOUS_LINK_PATTERN = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/|bit\.ly\/|tinyurl\.com\/|t\.co\/|cutt\.ly\/)/i;

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

  const normalized = String(message.content || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let repeatedCount = 0;
  if (normalized.length >= 4) {
    const repeatKey = key + ':' + normalized.slice(0, 500);
    const recent = (repeatedContentWindows.get(repeatKey) || []).filter(time => now - time <= REPEAT_WINDOW_MS);
    recent.push(now);
    repeatedContentWindows.set(repeatKey, recent);
    repeatedCount = recent.length;
  }

  if (antiSpamWindows.size > 5000 || repeatedContentWindows.size > 5000) {
    for (const [entryKey, entryTimes] of antiSpamWindows) {
      if (!entryTimes.length || now - entryTimes[entryTimes.length - 1] > ANTISPAM_WINDOW_MS) {
        antiSpamWindows.delete(entryKey);
        antiSpamCooldowns.delete(entryKey);
      }
    }
    for (const [entryKey, entryTimes] of repeatedContentWindows) {
      if (!entryTimes.length || now - entryTimes[entryTimes.length - 1] > REPEAT_WINDOW_MS) repeatedContentWindows.delete(entryKey);
    }
  }

  const burstDetected = timestamps.length > ANTISPAM_MAX_MESSAGES;
  const repeatDetected = repeatedCount >= REPEAT_MAX_MESSAGES;
  const suspiciousLink = SUSPICIOUS_LINK_PATTERN.test(message.content || '');

  // Les liens suspects ne sont pas supprimés automatiquement : ils sont signalés pour vérification humaine.
  if (suspiciousLink) {
    const linkAlertKey = 'link:' + key;
    const lastLinkAlert = antiSpamCooldowns.get(linkAlertKey) || 0;
    if (now - lastLinkAlert >= ANTISPAM_COOLDOWN_MS) {
      antiSpamCooldowns.set(linkAlertKey, now);
      void sendBotLog(message.guild, '🔎 Lien à vérifier', '**Membre :** <@' + message.author.id + '>\n' +
        '**Salon :** <#' + message.channel.id + '>\n**Action :** signalement uniquement, aucun lien supprimé automatiquement.', 0xd8b45a);
    }
  }

  if (!burstDetected && !repeatDetected) return;
  const lastAction = antiSpamCooldowns.get(key) || 0;
  if (now - lastAction < ANTISPAM_COOLDOWN_MS) return;
  antiSpamCooldowns.set(key, now);

  try {
    await message.delete();
    const reason = repeatDetected
      ? repeatedCount + ' messages identiques en 15 secondes'
      : timestamps.length + ' messages en 7 secondes';
    console.warn('CINEBOX_ANTISPAM_MESSAGE_DELETED', {
      guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id,
      messagesInWindow: timestamps.length, repeatedCount
    });
    void sendBotLog(message.guild, '🚨 Anti-spam : message supprimé',
      '**Membre :** <@' + message.author.id + '>\n**Salon :** <#' + message.channel.id + '>\n' +
      '**Détection :** ' + reason + '\n**Action :** dernier message supprimé, aucune sanction automatique.', 0xed4245);
  } catch (error) {
    console.error('CINEBOX_ANTISPAM_DELETE_FAILED', {
      guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id, error: error?.stack || error
    });
    void sendBotLog(message.guild, '⚠️ Anti-spam : suppression impossible',
      'Détection pour <@' + message.author.id + '> dans <#' + message.channel.id + '>, mais Discord a refusé la suppression. Vérifie la permission **Gérer les messages** du bot.', 0xed4245);
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

// Anti-raid souple : détecte les arrivées groupées et alerte les modérateurs sans bloquer les membres.
const antiRaidWindows = new Map();
const antiRaidAlertAt = new Map();
const ANTIRAID_WINDOW_MS = 30000;
const ANTIRAID_JOIN_THRESHOLD = 8;
const ANTIRAID_ALERT_COOLDOWN_MS = 60000;

function trackRaidJoin(member) {
  const now = Date.now();
  const guildId = member.guild.id;
  const recent = (antiRaidWindows.get(guildId) || []).filter(time => now - time <= ANTIRAID_WINDOW_MS);
  recent.push(now);
  antiRaidWindows.set(guildId, recent);

  if (antiRaidWindows.size > 1000) {
    for (const [id, times] of antiRaidWindows) {
      if (!times.length || now - times[times.length - 1] > ANTIRAID_WINDOW_MS) {
        antiRaidWindows.delete(id);
        antiRaidAlertAt.delete(id);
      }
    }
  }

  if (recent.length < ANTIRAID_JOIN_THRESHOLD) return;
  const lastAlert = antiRaidAlertAt.get(guildId) || 0;
  if (now - lastAlert < ANTIRAID_ALERT_COOLDOWN_MS) return;
  antiRaidAlertAt.set(guildId, now);

  const accountAgeDays = Math.floor((now - member.user.createdTimestamp) / 86400000);
  console.warn('CINEBOX_ANTIRAID_BURST', {
    guildId,
    joinsInWindow: recent.length,
    windowSeconds: ANTIRAID_WINDOW_MS / 1000,
    latestMemberId: member.id,
    latestAccountAgeDays: accountAgeDays
  });
  void sendBotLog(
    member.guild,
    '🚨 Alerte anti-raid : arrivées groupées',
    '**Détection :** ' + recent.length + ' membres ont rejoint en 30 secondes.\n' +
    '**Dernier arrivant :** <@' + member.id + '>\n' +
    '**Âge de son compte :** ' + accountAgeDays + ' jour(s)\n' +
    '**Action :** alerte uniquement. Aucun membre n’est expulsé, banni ou bloqué automatiquement.\n' +
    '**Conseil :** vérifie les profils récents et préviens l’équipe de modération si nécessaire.',
    0xed4245
  );
}

client.on('guildMemberAdd', async member => {
  trackRaidJoin(member);
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
      'Impossible de publier le message pour <@' + member.id + '>. Vérifie les permissions du bot dans le salon de bienvenue.\n' +
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
        '**' + member.user.username + '** quitte le club.\n\n' +
        'Merci d’avoir partagé un bout de l’aventure CinéBox avec nous. ' +
        'Les portes du ciné-club te resteront ouvertes. À une prochaine séance ! 🍿\n\n' +
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
