const nacl = require('tweetnacl');
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
  if (interaction.type !== 2) return res.status(400).send('Unsupported interaction');

  const name = interaction.data && interaction.data.name;
  if (name === 'ping') return reply(res, '🏓 Pong ! CinéBox répond via Vercel.');
  if (name === 'help') return reply(res, '**🎬 CinéBox — Commandes**\n/setup — Installer ou réparer les rôles et salons (administrateurs)\n/ping — Vérifier le bot\n/signaler — Transmettre un problème\n/suggestion — Proposer une idée');

  if (name === 'setup') {
    if (!hasPermission(interaction.member?.permissions, PERM.ADMIN)) return reply(res, 'Cette commande est réservée aux administrateurs.');
    if (!process.env.DISCORD_TOKEN || !interaction.guild_id) return reply(res, 'Configuration du bot incomplète.');
    res.status(200).json({ type: 5, data: { flags: EPHEMERAL } });
    console.log('SETUP_START', interaction.guild_id);
    try {
      const result = await setupGuild(interaction.guild_id, async (state) => {
        const percent = Math.min(100, Math.round(state.done / state.total * 100));
        const filled = Math.round(percent / 10);
        const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
        const content = '🎬 **CinéBox — Installation du serveur**\\n' + bar + ' **' + percent + '%**\\n' +
          'Étape **' + state.done + '/' + state.total + '** · ' + state.phase + '\\n' +
          'Dernière action : ' + state.label + '\\n' +
          'Créés : **' + state.created + '** · Vérifiés : **' + state.checked + '**';
        console.log('SETUP_PROGRESS', JSON.stringify(state));
        await editOriginal(interaction, content);
      });
      const details = result.created.length ? result.created.map(x => '• ' + x).join('\n') : 'Tout était déjà en place : aucun doublon créé.';
      console.log('SETUP_SUCCESS', result);
      await editOriginal(interaction, '✅ **Structure CinéBox installée !**\n' + result.created.length + ' éléments créés, ' + result.roles + ' rôles, ' + result.textChannels + ' salons texte et ' + result.voiceChannels + ' salons vocaux vérifiés.\n' + details);
    } catch (error) {
      console.error('SETUP_FAILED', error && error.stack || error);
      await editOriginal(interaction, '❌ Installation interrompue : ' + String(error.message || error).slice(0, 700));
    }
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
      return reply(res, report ? '✅ Ton signalement a été transmis à l’équipe.' : '✅ Merci ! Ta suggestion a été transmise.');
    } catch (error) {
      console.error('Message delivery failed:', error);
      return reply(res, 'Impossible de transmettre le message. Réessaie plus tard.');
    }
  }
  return reply(res, 'Commande inconnue.');
};

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

async function setupGuild(guildId, onProgress) {
  const progress = async (message) => { if (onProgress) await onProgress(message); };
  await progress('Connexion à Discord…');
  const results = await Promise.all([discord('/guilds/' + guildId + '/roles'), discord('/guilds/' + guildId + '/channels')]);
  const roles = results[0], channels = results[1], created = [];
  const roleIds = {};
  await progress('Vérification des rôles…');
  for (const def of defs) {
    let role = roles.find(r => r.name === def.name);
    if (!role) {
      role = await discord('/guilds/' + guildId + '/roles', { method: 'POST', body: { name: def.name, color: def.color, hoist: def.hoist, mentionable: false } });
      roles.push(role); created.push('Rôle ' + def.name);
    }
    roleIds[def.name] = role.id;
  }

  await progress('Rôles vérifiés. Préparation des catégories et salons…');
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
    if (!channel) {
      const body = Object.assign({ name, type }, extra);
      if (parentId) body.parent_id = parentId;
      channel = await discord('/guilds/' + guildId + '/channels', { method: 'POST', body });
      channels.push(channel);
      created.push((type === 4 ? 'Catégorie ' : type === 2 ? 'Vocal ' : '#') + name);
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
    return channel;
  }

  const textMap = {};
  for (const group of groups) {
    const category = await getOrCreate(group.name, 4, null, group.private ? { permission_overwrites: staff } : {});
    for (const pair of group.channels) {
      const channelName = pair[0], topic = pair[1];
      const overwrites = group.private ? staff : channelName === '🌟-espace-vip' ? vip : undefined;
      const extra = { topic };
      if (overwrites) extra.permission_overwrites = overwrites;
      textMap[channelName] = await getOrCreate(channelName, 0, category.id, extra);
    }
  }
  await progress('Salons textuels vérifiés. Préparation des salons vocaux…');
  const voiceCategory = await getOrCreate('06 — SALONS VOCAUX', 4, null, {});
  for (const name of voiceNames) await getOrCreate(name, 2, voiceCategory.id, {});

  await progress('Salons vocaux vérifiés. Finalisation des messages de bienvenue et du règlement…');
  const rules = textMap['📜-règlement'];
  if (rules && !(rules.topic || '').includes('[CINEBOX_RULES]')) {
    await discord('/channels/' + rules.id + '/messages', { method: 'POST', body: { content: '🎬 **Bienvenue au Club des Cinéphiles CinéBox !**\n\n1. Respecte chaque membre.\n2. Aucun harcèlement, discrimination ou insultes.\n3. Pas de spam ni de publicité non autorisée.\n4. Utilise les salons adaptés aux discussions.\n5. Attention aux spoilers : préviens et masque-les.\n6. Respecte les décisions de la modération.\n\nEn restant sur le serveur, tu acceptes ces règles. Bon visionnage ! 🍿' } });
    await discord('/channels/' + rules.id, { method: 'PATCH', body: { topic: '[CINEBOX_RULES] Règlement officiel du serveur.' } });
  }
  const discover = textMap['✨-découvrir-cinébox'];
  if (discover && !(discover.topic || '').includes('[CINEBOX_DISCOVER]')) {
    const welcomeId = textMap['👋-bienvenue'].id, newsId = textMap['📢-actualités-cinébox'].id, helpId = textMap['🆘-besoin-daide'].id;
    const content = '✨ **Bienvenue sur CinéBox !**\n\nRetrouve ici la communauté des passionnés de films et de séries. Présente-toi dans <#' + welcomeId + '>, échange dans les salons thématiques et partage tes recommandations.\n\n📢 Les annonces officielles sont publiées dans <#' + newsId + '>.\n🆘 Besoin d’aide ? Rendez-vous dans <#' + helpId + '>.\n\n**Installe-toi, la séance commence !** 🍿';
    await discord('/channels/' + discover.id + '/messages', { method: 'POST', body: { content } });
    await discord('/channels/' + discover.id, { method: 'PATCH', body: { topic: '[CINEBOX_DISCOVER] Présentation et liens utiles.' } });
  }
  return { created, roles: defs.length, textChannels: Object.keys(textMap).length, voiceChannels: 3 };
}

async function discord(path, options) {
  options = options || {};
  const method = options.method || 'GET';
  const maxAttempts = method === 'GET' || method === 'PATCH' ? 4 : 2;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(API + path, {
        method,
        headers: Object.assign({ Authorization: 'Bot ' + process.env.DISCORD_TOKEN }, options.body ? { 'Content-Type': 'application/json' } : {}),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(12000)
      });
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
      const transient = error instanceof TypeError || error.name === 'TimeoutError' || /UND_ERR_SOCKET|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(error));
      if (!transient || attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}
async function editOriginal(interaction, content) {
  const url = API + '/webhooks/' + interaction.application_id + '/' + interaction.token + '/messages/@original';
  const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  if (!response.ok) console.error('SETUP_EDIT_FAILED', response.status, await response.text());
  else console.log('SETUP_EDIT_OK');
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
