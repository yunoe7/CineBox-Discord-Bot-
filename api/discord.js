const nacl = require('tweetnacl');
const { waitUntil } = require('@vercel/functions');
const API = 'https://discord.com/api/v10';
const EPHEMERAL = 64;
const PERM = { ADMIN: 8n, VIEW: '1024', SEND: '2048', MANAGE_MESSAGES: '8192', HISTORY: '65536' };

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
  if (interaction.type === 3) return handleCinemaVote(interaction, res);
  if (interaction.type !== 2) return res.status(400).send('Unsupported interaction');

  const name = interaction.data && interaction.data.name;
  if (name === 'sondage-cinema') {
    if (!process.env.DISCORD_TOKEN || !interaction.channel_id) return reply(res, 'Configuration incomplète.');
    const opts = interaction.data.options || [];
    const get = key => opts.find(option => option.name === key)?.value;
    const title = get('titre');
    const films = ['film1','film2','film3','film4'].map(get).filter(Boolean).map(x => String(x).trim()).filter(Boolean);
    if (!title || films.length < 2) return reply(res, 'Il faut un titre et au moins deux films.');
    try {
      const embed = {
        title: '🍿 ' + String(title).slice(0, 240),
        description: 'La communauté choisit la prochaine séance.\n\n**Comment voter ?** Clique sur le bouton correspondant à ton film favori. Le compteur se met à jour sur ce message.\n\n*Un vote par clic : les votes multiples ne sont pas encore limités.*',
        color: 0xd8b45a,
        fields: films.map((film, index) => ({ name: film.slice(0, 240), value: '0 voix', inline: false })),
        footer: { text: 'CinéBox • Sondage cinéma' },
        timestamp: new Date().toISOString()
      };
      const components = [{ type: 1, components: films.map((film, index) => ({
        type: 2, style: 1, custom_id: 'cine_vote_' + index, label: 'Voter · ' + film.slice(0, 65)
      })) }];
      await discord('/channels/' + interaction.channel_id + '/messages', {
        method: 'POST', body: { content: '🎬 **Nouveau sondage cinéma !**', embeds: [embed], components }
      });
      return embedReply(res, { title: '🍿 Sondage publié !', description: 'Ton sondage est en ligne dans ce salon. Les membres peuvent maintenant choisir leur film préféré.', color: 0x57f287, footer: { text: 'CinéBox • Organisation des séances' }, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('CINEMA_POLL_CREATE_FAILED', error && error.stack || error);
      return embedReply(res, { title: '⚠️ Publication impossible', description: 'Le sondage n’a pas pu être publié. Vérifie que CinéBox possède les permissions **Voir le salon**, **Envoyer des messages** et **Intégrer des liens**.', color: 0xed4245, footer: { text: 'CinéBox • Assistance' } });
    }
  }

  if (name === 'tirage-cinema') {
    const opts = interaction.data.options || [];
    const films = ['film1','film2','film3','film4']
      .map(key => opts.find(option => option.name === key)?.value)
      .filter(Boolean)
      .map(value => String(value).trim())
      .filter(Boolean);
    if (films.length < 2) return reply(res, 'Ajoute au moins deux films pour effectuer le tirage.');
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
          title: '🎬  LA SÉANCE CINÉBOX EST CHOISIE !',
          description,
          color: 0xd8b45a,
          footer: { text: 'CinéBox • Le Club des Cinéphiles' },
          timestamp: new Date().toISOString()
        }]
      }
    });
  }

  if (name === 'ping') return embedReply(res, { title: '🏓 CinéBox est en ligne !', description: 'Tout fonctionne correctement. La séance peut commencer !', color: 0x57f287, footer: { text: 'CinéBox • Statut du bot' }, timestamp: new Date().toISOString() });
  if (name === 'help') return res.status(200).json({ type: 4, data: { flags: EPHEMERAL, embeds: [{ title: '🎬 Le guide du CinéBox', description: 'Toutes les commandes pour faire vivre le club des cinéphiles.', color: 0xd8b45a, fields: [{ name: '🍿 EXPÉRIENCE CINÉMA', value: '`/sondage-cinema` — Faites voter la communauté pour son prochain film.\n`/tirage-cinema` — Laissez le hasard choisir la prochaine séance.' }, { name: '🧰 VIE DU SERVEUR', value: '`/signaler` — Faites remonter un problème à l’équipe.\n`/suggestion` — Proposez une amélioration.' }, { name: '⚙️ OUTILS', value: '`/ping` — Vérifiez que le bot est disponible.\n`/setup` — Installez ou réparez le serveur (administrateurs).' }], footer: { text: 'CinéBox • Le Club des Cinéphiles' }, timestamp: new Date().toISOString() }] } });

  if (name === 'setup') {
    if (!hasPermission(interaction.member?.permissions, PERM.ADMIN)) return reply(res, 'Cette commande est réservée aux administrateurs.');
    if (!process.env.DISCORD_TOKEN || !interaction.guild_id) return reply(res, 'Configuration du bot incomplète.');
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
            title: '🎬 Installation de CinéBox',
            description: bar + ' **' + percent + '%**\n\n' + (state.label || 'Préparation en cours…'),
            color: 0xd8b45a,
            fields: [
              { name: 'Étape', value: state.done + ' / ' + state.total, inline: true },
              { name: 'Créés', value: String(state.created), inline: true },
              { name: 'Vérifiés', value: String(state.checked), inline: true }
            ],
            footer: { text: 'CinéBox • Configuration du serveur' }
          };
          console.log('SETUP_PROGRESS', JSON.stringify(state));
          // Never let a slow Discord webhook update block the actual setup work.
          void editOriginal(interaction, { content: '', embeds: [progressEmbed] });
        });
        const details = result.created.length ? result.created.map(x => '• ' + x).join('\n') : 'Tout était déjà en place : aucun doublon créé.';
        console.log('SETUP_SUCCESS', result);
        await editOriginal(interaction, { content: '', embeds: [{ title: '✨ Votre serveur CinéBox est prêt !', description: 'La structure du club a été installée avec succès. Place à la communauté ! 🍿', color: 0x57f287, fields: [{ name: 'Éléments créés', value: String(result.created.length), inline: true }, { name: 'Rôles', value: String(result.roles), inline: true }, { name: 'Salons texte', value: String(result.textChannels), inline: true }, { name: 'Salons vocaux', value: String(result.voiceChannels), inline: true }, { name: 'Détails', value: details.slice(0, 1000) }], footer: { text: 'CinéBox • Installation terminée' }, timestamp: new Date().toISOString() }] });
      } catch (error) {
        console.error('SETUP_FAILED', error && error.stack || error);
        await editOriginal(interaction, { content: '', embeds: [{ title: '⚠️ Installation interrompue', description: 'CinéBox n’a pas pu terminer la configuration.\n\n`' + String(error.message || error).slice(0, 700) + '`', color: 0xed4245, footer: { text: 'CinéBox • Assistance administrateur' } }] });
      }
    })();
    waitUntil(task);
    return;
  }

  if (name === 'signaler' || name === 'suggestion') {
    const report = name === 'signaler';
    const optionName = report ? 'message' : 'idee';
    const value = interaction.data.options && interaction.data.options.find(x => x.name === optionName)?.value;
    if (!value || !process.env.DISCORD_TOKEN || !interaction.guild_id) return reply(res, 'Configuration du bot incomplète. Préviens un administrateur.');
    try {
      const configuredId = report ? process.env.REPORT_CHANNEL_ID : process.env.SUGGESTION_CHANNEL_ID;
      let channelId = configuredId;
      if (!channelId) {
        const channels = await discord('/guilds/' + interaction.guild_id + '/channels');
        const targetName = report ? '🐛-signaler-un-bug' : '💡-boîte-à-idées';
        channelId = channels.find(c => c.name === targetName && c.type === 0)?.id;
      }
      if (!channelId) return reply(res, 'Salon introuvable. Un administrateur doit lancer /setup.');
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
      return embedReply(res, { title: report ? '🐛 Signalement transmis' : '💡 Suggestion envoyée', description: report ? 'Merci de nous avoir prévenus. L’équipe CinéBox pourra examiner ton signalement.' : 'Merci de contribuer à faire évoluer CinéBox. Ton idée a bien été transmise à l’équipe.', color: 0x57f287, footer: { text: 'CinéBox • Merci pour ta participation' }, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Message delivery failed:', error);
      return reply(res, 'Impossible de transmettre le message. Réessaie plus tard.');
    }
  }
  return reply(res, 'Commande inconnue.');
};

function handleCinemaVote(interaction, res) {
  const customId = interaction.data && interaction.data.custom_id || '';
  const match = /^cine_vote_(\\d+)$/.exec(customId);
  if (!match || !interaction.message || !interaction.message.embeds || !interaction.message.embeds[0]) {
    return res.status(200).json({ type: 4, data: { content: 'Ce vote n’est plus disponible.', flags: EPHEMERAL } });
  }
  const index = Number(match[1]);
  const embed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
  const fields = embed.fields || [];
  if (!Number.isInteger(index) || index < 0 || index >= fields.length) {
    return res.status(200).json({ type: 4, data: { content: 'Option de vote invalide.', flags: EPHEMERAL } });
  }
  const current = Number.parseInt(String(fields[index].value || '0').match(/\\d+/)?.[0] || '0', 10);
  fields[index].value = (current + 1) + ' voix';
  embed.fields = fields;
  const components = [{ type: 1, components: fields.map((field, i) => ({
    type: 2,
    style: i === index ? 3 : 1,
    custom_id: 'cine_vote_' + i,
    label: 'Voter · ' + String(field.name).slice(0, 65)
  })) }];
  console.log('CINEMA_VOTE', JSON.stringify({ guild: interaction.guild_id, option: index }));
  return res.status(200).json({ type: 7, data: { embeds: [embed], components } });
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

function reply(res, content) { return res.status(200).json({ type: 4, data: { content, flags: EPHEMERAL } }); }\nfunction embedReply(res, embed) { return res.status(200).json({ type: 4, data: { flags: EPHEMERAL, embeds: [embed] } }); }

async function setupGuild(guildId, onProgress) {
  const defs = [
    { name: '👑 Fondateur', color: 0xf1c75b, hoist: true },
    { name: '💎 VIP CinéBox', color: 0xd8b4fe, hoist: true },
    { name: '🛡️ Modérateur', color: 0x60a5fa, hoist: true },
    { name: '🎬 Cinéphile', color: 0xe5c76b, hoist: false },
    { name: '🍿 Nouveau membre', color: 0x9ca3af, hoist: false }
  ];
  const groups = [
    { name: '01 — LE GRAND ÉCRAN', channels: [['👋-bienvenue','Bienvenue au club ! Présente-toi et découvre la communauté.'],['📢-actualités-cinébox','Les annonces et actualités officielles de CinéBox.'],['📜-règlement','Les règles pour que tout le monde profite du serveur.'],['✨-découvrir-cinébox','Découvre CinéBox et les liens utiles.']] },
    { name: '02 — LE FOYER DES CINÉPHILES', channels: [['💬-le-salon','Le salon général de la communauté.'],['🎞️-discussions-films','Parlons cinéma et dernières sorties.'],['📺-discussions-séries','Vos séries du moment et vos théories.'],['🍿-soirée-cinéma','Organisons les prochaines soirées cinéma.'],['❤️-coups-de-cœur','Vos pépites et coups de cœur.'],['🔎-que-regarder','Besoin d’une recommandation ? Demande ici.']] },
    { name: '03 — LE CLUB VIP', channels: [['🌟-espace-vip','Un espace réservé aux membres VIP et à l’équipe.'],['🏆-membres-à-la-une','Les membres et contributions à l’honneur.'],['🎁-surprises','Surprises et événements spéciaux.']] },
    { name: '04 — ASSISTANCE & AMÉLIORATIONS', channels: [['🆘-besoin-daide','Une question ? La communauté et l’équipe sont là.'],['🐛-signaler-un-bug','Utilise /signaler pour transmettre un problème.'],['💡-boîte-à-idées','Utilise /suggestion pour proposer une idée.'],['🚀-nouveautés-à-venir','Les nouveautés et améliorations à venir.']] },
    { name: '05 — LES COULISSES (PRIVÉ)', private: true, channels: [['👑-direction','Espace privé de direction.'],['🛡️-modération','Coordination de la modération.'],['🧪-tests-cinébox','Tests internes du serveur et du site.'],['📋-journal-équipe','Suivi des actions de l’équipe.']] }
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
      const overwrites = group.private ? staff : channelName === '🌟-espace-vip' ? vip : undefined;
      const extra = { topic };
      if (overwrites) extra.permission_overwrites = overwrites;
      textMap[channelName] = await getOrCreate(channelName, 0, category.id, extra);
    }
  }
  const voiceCategory = await getOrCreate('06 — SALONS VOCAUX', 4, null, {});
  for (const name of voiceNames) await getOrCreate(name, 2, voiceCategory.id, {});
  const rules = textMap['📜-règlement'];
  if (rules && !(rules.topic || '').includes('[CINEBOX_RULES]')) {
    await discord('/channels/' + rules.id + '/messages', { method: 'POST', body: { content: '🎬 **Bienvenue au Club des Cinéphiles CinéBox !**\n\n1. Respecte chaque membre.\n2. Aucun harcèlement, discrimination ou insultes.\n3. Pas de spam ni de publicité non autorisée.\n4. Utilise les salons adaptés aux discussions.\n5. Attention aux spoilers : préviens et masque-les.\n6. Respecte les décisions de la modération.\n\nEn restant sur le serveur, tu acceptes ces règles. Bon visionnage ! 🍿' } });
    await discord('/channels/' + rules.id, { method: 'PATCH', body: { topic: '[CINEBOX_RULES] Règlement officiel du serveur.' } });
  }
  await progress('Finalisation', 'Règlement', false);
  const discover = textMap['✨-découvrir-cinébox'];
  if (discover && !(discover.topic || '').includes('[CINEBOX_DISCOVER]')) {
    const welcomeId = textMap['👋-bienvenue'].id, newsId = textMap['📢-actualités-cinébox'].id, helpId = textMap['🆘-besoin-daide'].id;
    const content = '✨ **Bienvenue sur CinéBox !**\n\nRetrouve ici la communauté des passionnés de films et de séries. Présente-toi dans <#' + welcomeId + '>, échange dans les salons thématiques et partage tes recommandations.\n\n📢 Les annonces officielles sont publiées dans <#' + newsId + '>.\n🆘 Besoin d’aide ? Rendez-vous dans <#' + helpId + '>.\n\n**Installe-toi, la séance commence !** 🍿';
    await discord('/channels/' + discover.id + '/messages', { method: 'POST', body: { content } });
    await discord('/channels/' + discover.id, { method: 'PATCH', body: { topic: '[CINEBOX_DISCOVER] Présentation et liens utiles.' } });
  }
  await progress('Finalisation', 'Message de présentation', false);
  return { created, roles: defs.length, textChannels: Object.keys(textMap).length, voiceChannels: voiceNames.length };
}

async function discord(path, options) {
  options = options || {};
  const method = options.method || 'GET';
  const maxAttempts = method === 'GET' || method === 'PATCH' ? 2 : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    console.log('DISCORD_API_START', method, path, 'attempt', attempt);
    try {
      const response = await fetch(API + path, {
        method,
        headers: Object.assign({ Authorization: 'Bot ' + process.env.DISCORD_TOKEN }, options.body ? { 'Content-Type': 'application/json' } : {}),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(8000)
      });
      console.log('DISCORD_API_RESPONSE', method, path, response.status, Date.now() - started + 'ms');
      if (response.status === 429) {
        const data = await response.json();
        await new Promise(resolve => setTimeout(resolve, Math.ceil((data.retry_after || 1) * 1000)));
        attempt--;
        continue;
      }
      if (!response.ok) throw new Error('Discord API ' + response.status + ': ' + await response.text());
      if (response.status === 204) return null;
      return response.json();
    } catch (error) {
      lastError = error;
      console.error('DISCORD_API_ERROR', method, path, 'attempt', attempt, Date.now() - started + 'ms', error && error.message || error);
      const transient = error instanceof TypeError || error.name === 'TimeoutError' || /UND_ERR_SOCKET|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(error));
      if (!transient || attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
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
