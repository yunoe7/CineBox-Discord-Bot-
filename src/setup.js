const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const ROLE_DEFS = [
  { name: '👑 Fondateur', color: 0xf1c75b, hoist: true },
  { name: '💎 VIP Movix', color: 0xd8b4fe, hoist: true },
  { name: '🛡️ Modérateur', color: 0x60a5fa, hoist: true },
  { name: '🎬 Cinéphile', color: 0xe5c76b, hoist: false },
  { name: '🍿 Nouveau membre', color: 0x9ca3af, hoist: false },
  { name: '🤝 Ami de Movix', color: 0x78c6a3, hoist: false },
  { name: '🌟 Ami fidèle', color: 0xf4a7c4, hoist: false },
  { name: '🎟️ Invité du ciné-club', color: 0x8bb8e8, hoist: false },
];

const CATEGORIES = [
  { name: '01 • LE GRAND ÉCRAN', channels: [
    ['👋•bienvenue', 'Bienvenue au club ! Présente-toi et découvre la communauté.'],
    ['📢•actualités-movix', 'Les annonces et actualités officielles de Movix.'],
    ['📜•règlement', 'Les règles pour que tout le monde profite du serveur.'],
    ['✨•découvrir-movix', 'Découvre Movix et les liens utiles.'],
  ]},
  { name: '02 • LE FOYER DES CINÉPHILES', channels: [
    ['💬•le-salon', 'Le salon général de la communauté.'],
    ['🎞️•discussions-films', 'Parlons cinéma et dernières sorties.'],
    ['📺•discussions-séries', 'Vos séries du moment et vos théories.'],
    ['🍿•soirée-cinéma', 'Organisons les prochaines soirées cinéma.'],
    ['❤️•coups-de-cœur', 'Partage tes pépites et coups de cœur.'],
    ['🔎•que-regarder', 'Besoin d’une recommandation ? Demande ici.'],
  ]},
  { name: '03 • LE CLUB VIP', channels: [
    ['🌟•espace-vip', 'Un espace réservé aux membres VIP et à l’équipe.'],
    ['🏆•membres-à-la-une', 'Les membres et contributions à l’honneur.'],
    ['🎁•surprises', 'Surprises et événements spéciaux.'],
  ]},
  { name: '04 • ASSISTANCE & AMÉLIORATIONS', channels: [
    ['🆘•besoin-daide', 'Une question ? La communauté et l’équipe sont là.'],
    ['🐛•signaler-un-bug', 'Utilise /signaler pour transmettre un problème.'],
    ['💡•boîte-à-idées', 'Utilise /suggestion pour proposer une amélioration.'],
    ['🚀•nouveautés-à-venir', 'Les nouveautés et améliorations à venir.'],
  ]},
  { name: '05 • LES COULISSES (PRIVÉ)', private: true, channels: [
    ['👑•direction', 'Espace privé de direction.'],
    ['🛡️•modération', 'Coordination de la modération.'],
    ['🧪•tests-movix', 'Tests internes du serveur et du site.'],
    ['📋•journal-équipe', 'Suivi des actions de l’équipe.'],
  ]},
];

const VOICE_CHANNELS = ['🔊・Le Grand Salon', '🔊・Séance privée', '🔊・After Movie'];

async function getOrCreateRole(guild, definition, created) {
  let role = guild.roles.cache.find(r => r.name === definition.name);
  if (!role) {
    role = await guild.roles.create({
      name: definition.name, color: definition.color, hoist: definition.hoist,
      mentionable: false, reason: 'Installation de la structure Movix',
    });
    created.push('Rôle ' + definition.name);
  }
  return role;
}

async function getOrCreateCategory(guild, name, overwrites, created) {
  let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
  if (!category) {
    category = await guild.channels.create({
      name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites,
      reason: 'Installation de la structure Movix',
    });
    created.push('Catégorie ' + name);
  } else if (overwrites) {
    await category.permissionOverwrites.set(overwrites, 'Mise à jour des accès Movix');
  }
  return category;
}

async function getOrCreateText(guild, category, name, topic, created) {
  let channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === name);
  if (!channel && name.includes('•')) {
    const legacyName = name.replace('•', '-');
    channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === legacyName);
    if (channel) await channel.setName(name, 'Harmonisation des noms Movix');
  }
  if (!channel) {
    channel = await guild.channels.create({
      name, type: ChannelType.GuildText, parent: category.id, topic,
      reason: 'Installation de la structure Movix',
    });
    created.push('#' + name);
  } else if (channel.parentId !== category.id) {
    await channel.setParent(category.id, { lockPermissions: true, reason: 'Rangement des salons Movix' });
  }
  return channel;
}

async function setupGuild(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const created = [];
  const roles = {};
  for (const def of ROLE_DEFS) roles[def.name] = await getOrCreateRole(guild, def, created);

  const everyone = guild.roles.everyone;
  const modRole = roles['🛡️ Modérateur'];
  const founderRole = roles['👑 Fondateur'];
  const vipRole = roles['💎 VIP Movix'];
  const staffOverwrite = [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: founderRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: modRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ];
  const vipOverwrite = [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: vipRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
    { id: founderRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
    { id: modRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ];

  const textChannels = {};
  for (const group of CATEGORIES) {
    const category = await getOrCreateCategory(guild, group.name, group.private ? staffOverwrite : null, created);
    for (const [name, topic] of group.channels) {
      const channel = await getOrCreateText(guild, category, name, topic, created);
      textChannels[name] = channel;
      if (group.private) await channel.permissionOverwrites.set(staffOverwrite, 'Salons réservés à l’équipe');
      if (name === '🌟•espace-vip') await channel.permissionOverwrites.set(vipOverwrite, 'Salon réservé aux VIP et à l’équipe');
    }
  }

  let voiceCategory = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === '06 • SALONS VOCAUX');
  if (!voiceCategory) {
    voiceCategory = await guild.channels.create({ name: '06 • SALONS VOCAUX', type: ChannelType.GuildCategory, reason: 'Installation Movix' });
    created.push('Catégorie ' + voiceCategory.name);
  }
  for (const name of VOICE_CHANNELS) {
    let channel = guild.channels.cache.find(c => c.type === ChannelType.GuildVoice && c.name === name);
    if (!channel) {
      await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: voiceCategory.id, reason: 'Installation Movix' });
      created.push('Vocal ' + name);
    }
  }

  const welcome = textChannels['👋•bienvenue'];
  if (!welcome.topic?.includes('[MOVIX_WELCOME]')) {
    await welcome.setTopic('[MOVIX_WELCOME] Bienvenue au club ! Présente-toi et découvre la communauté.');
  }
  const rules = textChannels['📜•règlement'];
  if (rules && !rules.topic?.includes('[MOVIX_RULES]')) {
    await rules.send({ content: '🎬 **Bienvenue au Club des Cinéphiles Movix !**\n\n1. Respecte chaque membre.\n2. Aucun harcèlement, discrimination ou insultes.\n3. Pas de spam ni de publicité non autorisée.\n4. Utilise les salons adaptés aux discussions.\n5. Attention aux spoilers : préviens et masque-les.\n6. Respecte les décisions de la modération.\n\nEn restant sur le serveur, tu acceptes ces règles. Bon visionnage ! 🍿' });
    await rules.setTopic('[MOVIX_RULES] Règlement officiel du serveur.');
  }
  const discover = textChannels['✨•découvrir-movix'];
  if (discover && !discover.topic?.includes('[MOVIX_DISCOVER]')) {
    await discover.send({ content: '✨ **Bienvenue sur Movix !**\n\nRetrouve ici la communauté des passionnés de films et de séries. Présente-toi dans <#' + welcome.id + '>, échange dans les salons thématiques et partage tes recommandations.\n\n📢 Les annonces officielles sont publiées dans <#' + textChannels['📢•actualités-movix'].id + '>.\n🆘 Besoin d’aide ? Rendez-vous dans <#' + textChannels['🆘•besoin-daide'].id + '>.\n\n**Installe-toi, la séance commence !** 🍿' });
    await discover.setTopic('[MOVIX_DISCOVER] Présentation et liens utiles.');
  }

  return { created, roles: Object.keys(roles).length, textChannels: Object.keys(textChannels).length, voiceChannels: VOICE_CHANNELS.length };
}

module.exports = { setupGuild };
