require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ChannelType,
} = require('discord.js');
const { setupGuild } = require('./setup');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Configuration manquante : renseigne DISCORD_TOKEN et CLIENT_ID dans les variables d’environnement.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Installe ou répare la structure complète du serveur CinéBox.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('ping').setDescription('Vérifie que le bot répond.'),
  new SlashCommandBuilder().setName('help').setDescription('Affiche les commandes du bot CinéBox.'),
  new SlashCommandBuilder().setName('signaler').setDescription('Signale un bug ou un problème à l’équipe.')
    .addStringOption(o => o.setName('message').setDescription('Décris le problème').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('suggestion').setDescription('Propose une amélioration pour CinéBox.')
    .addStringOption(o => o.setName('idee').setDescription('Décris ton idée').setRequired(true).setMaxLength(1500)),
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
}

client.once('ready', () => console.log('CinéBox Bot connecté en tant que ' + client.user.tag));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'ping') {
      return interaction.reply({ content: '🏓 Pong ! CinéBox est en ligne.', ephemeral: true });
    }
    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder().setColor(0xd8b45a).setTitle('🎬 CinéBox — Commandes')
        .setDescription('**/setup** — Installer la structure (administrateurs)\n**/ping** — Vérifier le bot\n**/signaler** — Envoyer un signalement privé à l’équipe\n**/suggestion** — Proposer une idée à la communauté')
        .setFooter({ text: 'Le Club des Cinéphiles' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    if (interaction.commandName === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Cette commande est réservée aux administrateurs.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await setupGuild(interaction.guild);
      return interaction.editReply('✅ **Structure CinéBox installée !**\n' + result.created.length + ' éléments créés, ' + (result.roles + result.textChannels + result.voiceChannels) + ' rôles/salons configurés.\n' + (result.created.length ? result.created.map(x => '• ' + x).join('\n') : 'Tout était déjà en place : aucun doublon créé.'));
    }
    if (interaction.commandName === 'signaler' || interaction.commandName === 'suggestion') {
      const isReport = interaction.commandName === 'signaler';
      const targetName = isReport ? '🐛-signaler-un-bug' : '💡-boîte-à-idées';
      const target = interaction.guild.channels.cache.find(c => c.name === targetName && c.type === ChannelType.GuildText);
      if (!target) return interaction.reply({ content: 'Le salon cible est introuvable. Un administrateur doit lancer /setup.', ephemeral: true });
      const message = interaction.options.getString(isReport ? 'message' : 'idee', true);
      const embed = new EmbedBuilder().setColor(isReport ? 0xef8354 : 0xd8b45a)
        .setTitle(isReport ? '🐛 Nouveau signalement' : '💡 Nouvelle suggestion')
        .setDescription(message).addFields(
          { name: 'Membre', value: interaction.user.tag, inline: true },
          { name: 'Serveur', value: interaction.guild.name, inline: true },
        ).setTimestamp();
      await target.send({ embeds: [embed] });
      return interaction.reply({ content: isReport ? '✅ Ton signalement a été transmis à l’équipe.' : '✅ Merci ! Ta suggestion a été transmise.', ephemeral: true });
    }
  } catch (error) {
    console.error('Erreur commande :', error);
    const message = 'Une erreur est survenue. Vérifie les permissions du bot et consulte les logs.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error('Démarrage impossible :', error);
    process.exit(1);
  }
})();
