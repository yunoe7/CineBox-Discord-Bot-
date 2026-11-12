require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  throw new Error('DISCORD_TOKEN et CLIENT_ID sont requis.');
}

const commands = [

  new SlashCommandBuilder().setName('modlogs').setDescription('Consulte les 10 dernières actions de modération.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('warn').setDescription('Avertit un membre et consigne l’action dans les logs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à avertir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Motif de l’avertissement').setRequired(false).setMaxLength(450)),
  new SlashCommandBuilder().setName('warnings').setDescription('Consulte les avertissements enregistrés d’un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à consulter').setRequired(true)),
  new SlashCommandBuilder().setName('clear-warnings').setDescription('Efface les avertissements enregistrés d’un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre concerné').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Motif de l’effacement').setRequired(false).setMaxLength(300)),
  new SlashCommandBuilder().setName('timeout').setDescription('Empêche temporairement un membre de participer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à mettre en sourdine').setRequired(true))
    .addIntegerOption(o => o.setName('duree').setDescription('Durée en minutes (1 à 40 320)').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Motif').setRequired(false).setMaxLength(450)),
  new SlashCommandBuilder().setName('untimeout').setDescription('Retire la mise en sourdine d’un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à rétablir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Motif').setRequired(false).setMaxLength(450)),
  new SlashCommandBuilder().setName('kick').setDescription('Expulse un membre du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à expulser').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Motif').setRequired(false).setMaxLength(450)),
  new SlashCommandBuilder().setName('ban').setDescription('Bannit un membre du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à bannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Motif').setRequired(false).setMaxLength(450)),
  new SlashCommandBuilder().setName('setup').setDescription('Installe ou répare la structure complète du serveur CinéBox.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('config-accueil').setDescription('Configure manuellement les messages de bienvenue et de départ.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('salon-bienvenue').setDescription('Salon où publier les arrivées').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addChannelOption(o => o.setName('salon-depart').setDescription('Salon où publier les départs').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addBooleanOption(o => o.setName('activer-bienvenue').setDescription('Activer ou désactiver le message de bienvenue').setRequired(false))
    .addBooleanOption(o => o.setName('activer-depart').setDescription('Activer ou désactiver le message de départ').setRequired(false))
    .addBooleanOption(o => o.setName('role-automatique').setDescription('Attribuer automatiquement un rôle à l’arrivée').setRequired(false))
    .addRoleOption(o => o.setName('role-nouveau').setDescription('Rôle à attribuer si le rôle automatique est activé').setRequired(false)),
  new SlashCommandBuilder().setName('reset-cinebox').setDescription('Supprime la structure CinéBox après confirmation.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('mon-compte').setDescription('Vérifie la liaison entre ton compte Discord et CineBox.'),
  new SlashCommandBuilder().setName('ping').setDescription('Vérifie que le bot répond.'),
  new SlashCommandBuilder().setName('help').setDescription('Affiche les commandes CinéBox.'),
  new SlashCommandBuilder().setName('signaler').setDescription('Signale un bug ou un problème à l’équipe.')
    .addStringOption(o => o.setName('message').setDescription('Décris le problème').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('cloturer-sondage').setDescription('Clôture le dernier sondage CinéBox de ce salon et affiche le résultat.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
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
  new SlashCommandBuilder().setName('recommandation-cinema').setDescription('Trouve un film selon ton envie du moment.')
    .addStringOption(o => o.setName('genre').setDescription('Le genre que tu préfères').setRequired(false).addChoices(
      { name: 'Tous les genres', value: 'tous' },
      { name: 'Aventure', value: 'aventure' },
      { name: 'Animation', value: 'animation' },
      { name: 'Comédie', value: 'comedie' },
      { name: 'Drame', value: 'drame' },
      { name: 'Science-fiction', value: 'science-fiction' },
      { name: 'Thriller', value: 'thriller' }
    ))
    .addStringOption(o => o.setName('ambiance').setDescription('Ton humeur pour ce soir').setRequired(false).addChoices(
      { name: 'Surprise', value: 'surprise' },
      { name: 'Détente', value: 'detente' },
      { name: 'Frissons', value: 'frissons' },
      { name: 'Évasion', value: 'evasion' },
      { name: 'Émotion', value: 'emotion' },
      { name: 'Réflexion', value: 'reflexion' }
    )),
  new SlashCommandBuilder().setName('quiz-cinema').setDescription('Teste ta culture cinéma avec une question interactive.'),
  new SlashCommandBuilder().setName('programmer-seance').setDescription('Crée un événement Discord pour la prochaine séance cinéma.')
    .setDefaultMemberPermissions(17592186044416n)
    .addStringOption(o => o.setName('film').setDescription('Film de la séance').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('date').setDescription('Date au format AAAA-MM-JJ, heure de Paris').setRequired(true).setMaxLength(10))
    .addStringOption(o => o.setName('heure').setDescription('Heure au format HH:MM, heure de Paris').setRequired(true).setMaxLength(5))
    .addChannelOption(o => o.setName('salon').setDescription('Salon vocal de la séance').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
    .addIntegerOption(o => o.setName('duree').setDescription('Durée en minutes (60 à 360, défaut 120)').setMinValue(60).setMaxValue(360).setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Informations complémentaires').setRequired(false).setMaxLength(500)),
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
