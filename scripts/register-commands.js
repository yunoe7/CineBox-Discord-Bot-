require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  throw new Error('DISCORD_TOKEN et CLIENT_ID sont requis.');
}

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Installe ou répare la structure complète du serveur CinéBox.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('ping').setDescription('Vérifie que le bot répond.'),
  new SlashCommandBuilder().setName('help').setDescription('Affiche les commandes CinéBox.'),
  new SlashCommandBuilder().setName('signaler').setDescription('Signale un bug ou un problème à l’équipe.')
    .addStringOption(o => o.setName('message').setDescription('Décris le problème').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('sondage-cinema').setDescription('Lance un vote pour choisir le prochain film à regarder.')
    .addStringOption(o => o.setName('titre').setDescription('Question du sondage, par exemple : Film de vendredi ?').setRequired(true).setMaxLength(240))
    .addStringOption(o => o.setName('film1').setDescription('Premier film').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('film2').setDescription('Deuxième film').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('film3').setDescription('Troisième film (facultatif)').setRequired(false).setMaxLength(100))
    .addStringOption(o => o.setName('film4').setDescription('Quatrième film (facultatif)').setRequired(false).setMaxLength(100)),
  new SlashCommandBuilder().setName('tirage-cinema').setDescription('Choisit au hasard le film de la prochaine séance.')
    .addStringOption(o => o.setName('film1').setDescription('Premier film').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('film2').setDescription('Deuxième film').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('film3').setDescription('Troisième film (facultatif)').setRequired(false).setMaxLength(100))
    .addStringOption(o => o.setName('film4').setDescription('Quatrième film (facultatif)').setRequired(false).setMaxLength(100)),
  new SlashCommandBuilder().setName('suggestion').setDescription('Propose une amélioration pour CinéBox.')
    .addStringOption(o => o.setName('idee').setDescription('Décris ton idée').setRequired(true).setMaxLength(1500)),
].map(command => command.toJSON());

(async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log('Commandes CinéBox enregistrées.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
