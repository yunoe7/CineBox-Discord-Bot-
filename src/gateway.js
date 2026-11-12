require('dotenv').config();
const { createServer } = require('node:http');
const interactionHandler = require('../api/discord');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN est requis pour le service Gateway CinéBox.');

const SITE_URL = 'https://cinebox-a1h.pages.dev/';
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
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

async function readWelcomeConfig(guild) {
  try {
    const configChannel = guild.channels.cache.find(channel => channel.name === '📋•journal-équipe' && channel.isTextBased());
    if (!configChannel) return null;
    const fresh = await configChannel.fetch(true);
    const match = (fresh.topic || '').match(/CINEBOX_WELCOME_CONFIG:(\\{[^}]*\\})/);
    if (!match) return null;
    return JSON.parse(match[1]);
  } catch (error) {
    console.error('CINEBOX_WELCOME_CONFIG_READ_FAILED', error);
    return null;
  }
}

client.on('guildMemberAdd', async member => {
  console.log('CINEBOX_MEMBER_JOIN ' + member.user.id);
  void sendBotLog(member.guild, '👋 Nouveau membre', '**' + (member.user.tag || member.user.username) + '** a rejoint le serveur.\nID : ' + member.id);
  try {
    const config = await readWelcomeConfig(member.guild);
    if (!config) return;
    if (config.autoRoleEnabled && config.newMemberRoleId) {
      const role = await member.guild.roles.fetch(config.newMemberRoleId).catch(() => null);
      if (role) await member.roles.add(role, 'Rôle automatique configuré par un administrateur CinéBox');
    }
    if (!config.welcomeEnabled || !config.welcomeChannelId) return;
    const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setColor(0xd8b45a)
      .setAuthor({ name: 'CINÉBOX  /  BIENVENUE AU CLUB' })
      .setTitle('🎬 Bienvenue ' + (member.user.globalName || member.user.username) + ' !')
      .setDescription(
        'Installe-toi confortablement, la séance va commencer. 🍿\\n\\n' +
        'Tu rejoins **CinéBox**, le club des passionnés de films et de séries. ' +
        'Présente-toi et découvre les salons du serveur.\\n\\n' +
        '🌐 [Découvrir le site CinéBox](' + SITE_URL + ')'
      )
      .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '🎟️ TON PASS', value: 'Membre **n°' + member.guild.memberCount + '** du club', inline: true },
        { name: '🍿 À TOI DE JOUER', value: 'Dis-nous quel film tu pourrais revoir 100 fois !', inline: true }
      )
      .setFooter({ text: 'CINÉBOX  •  LE CLUB DES CINÉPHILES  •  🍿' })
      .setTimestamp();
    await channel.send({ content: '✨ <@' + member.id + '> rejoint le ciné-club !', embeds: [embed] });
  } catch (error) {
    console.error('CINEBOX_WELCOME_ERROR', error);
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
