const { verifyKey } = require('discord-interactions');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const rawBody = await readRawBody(req);

  if (!signature || !timestamp || !process.env.DISCORD_PUBLIC_KEY ||
      !verifyKey(rawBody, signature, timestamp, process.env.DISCORD_PUBLIC_KEY)) {
    return res.status(401).send('Invalid request signature');
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  // Discord endpoint verification (PING)
  if (interaction.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  if (interaction.type !== 2) {
    return res.status(400).send('Unsupported interaction');
  }

  const name = interaction.data?.name;
  if (name === 'ping') {
    return res.status(200).json({
      type: 4,
      data: { content: '🏓 Pong ! CinéBox répond via Vercel.', flags: 64 }
    });
  }

  if (name === 'help') {
    return res.status(200).json({
      type: 4,
      data: {
        content: '**🎬 CinéBox — Commandes**\n/setup — Installer la structure (migration en cours)\n/ping — Vérifier le bot\n/signaler — Signaler un problème\n/suggestion — Proposer une idée',
        flags: 64
      }
    });
  }

  if (name === 'setup') {
    return res.status(200).json({
      type: 4,
      data: { content: '⚙️ La migration de /setup vers le mode HTTP est en préparation. Aucune modification du serveur n’a été effectuée.', flags: 64 }
    });
  }

  if (name === 'signaler' || name === 'suggestion') {
    const isReport = name === 'signaler';
    const optionName = isReport ? 'message' : 'idee';
    const value = interaction.data?.options?.find(option => option.name === optionName)?.value;
    const channelId = isReport ? process.env.REPORT_CHANNEL_ID : process.env.SUGGESTION_CHANNEL_ID;

    if (!value || !channelId || !process.env.DISCORD_TOKEN) {
      return res.status(200).json({
        type: 4,
        data: { content: 'Le salon cible ou la configuration du bot manque. Préviens un administrateur.', flags: 64 }
      });
    }

    const title = isReport ? '🐛 Nouveau signalement' : '💡 Nouvelle suggestion';
    const payload = {
      embeds: [{
        title,
        description: String(value).slice(0, 1500),
        color: isReport ? 0xef8354 : 0xd8b45a,
        fields: [
          { name: 'Membre', value: interaction.member?.user?.username || interaction.user?.username || 'Membre', inline: true },
          { name: 'Serveur', value: interaction.guild_id || 'Inconnu', inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    };

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Discord API error:', response.status, await response.text());
      return res.status(200).json({
        type: 4,
        data: { content: 'Impossible de transmettre le message. Réessaie plus tard.', flags: 64 }
      });
    }

    return res.status(200).json({
      type: 4,
      data: { content: isReport ? '✅ Ton signalement a été transmis à l’équipe.' : '✅ Merci ! Ta suggestion a été transmise.', flags: 64 }
    });
  }

  return res.status(200).json({
    type: 4,
    data: { content: 'Commande inconnue.', flags: 64 }
  });
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
