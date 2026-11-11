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

client.once('ready', () => {
  console.log('CINEBOX_GATEWAY_READY ' + client.user.tag);
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'CinéBox 🍿 • cinebox-a1h.pages.dev', type: ActivityType.Playing }]
  });
});

client.on('guildMemberAdd', async member => {
  console.log('CINEBOX_MEMBER_JOIN ' + member.user.id);
  try {
    const role = member.guild.roles.cache.get(process.env.NEW_MEMBER_ROLE_ID) ||
      member.guild.roles.cache.find(item => item.name === '🍿 Nouveau membre');
    if (role) await member.roles.add(role, 'Bienvenue dans le club CinéBox');

    const channel = getTextChannel(member.guild, process.env.WELCOME_CHANNEL_ID, '👋-bienvenue');
    if (!channel) return;

    const intro = process.env.INTRO_CHANNEL_ID ? '<#' + process.env.INTRO_CHANNEL_ID + '>' : 'le salon de présentation';
    const rules = process.env.RULES_CHANNEL_ID ? '<#' + process.env.RULES_CHANNEL_ID + '>' : 'le salon règlement';
    const embed = new EmbedBuilder()
      .setColor(0xd8b45a)
      .setAuthor({ name: 'CINÉBOX  /  BIENVENUE AU CLUB' })
      .setTitle('🎬 Bienvenue ' + (member.user.globalName || member.user.username) + ' !')
      .setDescription(
        'Installe-toi confortablement, la séance va commencer. 🍿\n\n' +
        'Tu rejoins **CinéBox**, le club des passionnés de films et de séries. ' +
        'Présente-toi dans ' + intro + ', prends connaissance du règlement dans ' + rules +
        ' et partage tes découvertes avec la communauté.\n\n' +
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
  try {
    const channel = getTextChannel(member.guild, process.env.GOODBYE_CHANNEL_ID || process.env.WELCOME_CHANNEL_ID, '👋-bienvenue');
    if (!channel) return;
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
