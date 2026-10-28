// POST /api/fidel-link  { cardId, email }
// Called by the Wallet page right after Fidel links a card, to record which
// Podovo listener the card belongs to. If FIDEL_SECRET_KEY is set, the card is
// checked against Fidel first and its brand/last 4 are taken from Fidel.
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, FIDEL_SECRET_KEY (recommended)

const { upsert } = require('../lib/airtable');

const ALLOWED_ORIGINS = ['https://www.podovo.ai', 'https://podovo.ai'];

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.webflow\.io$/.test(origin);
  if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

async function fidelCard(cardId) {
  const key = String(process.env.FIDEL_SECRET_KEY || '').trim();
  if (!key) return null;
  const res = await fetch(`https://api.fidel.uk/v1/cards/${encodeURIComponent(cardId)}`, {
    headers: { 'Fidel-Key': key, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return false;
  if (!res.ok) return null; // can't check right now; still record the link
  const data = await res.json();
  return (data.items && data.items[0]) || data;
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  const cardId = String(body.cardId || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return res.status(400).json({ error: 'cardId required' });
  if (!email.includes('@')) return res.status(400).json({ error: 'email required' });

  try {
    const card = await fidelCard(cardId);
    if (card === false) return res.status(404).json({ error: 'Unknown card' });
    const fields = { 'Card ID': cardId, Email: email, Status: 'Linked' };
    // Only fill fields we actually know, so we never blank what the webhook saved.
    const scheme = (card && card.scheme) || body.scheme;
    const last4 = (card && card.lastNumbers) || body.last4;
    if (scheme) fields.Scheme = String(scheme).slice(0, 20);
    if (last4 && /^\d{4}$/.test(String(last4))) fields.Last4 = String(last4);
    if (card && card.live !== undefined) fields.Live = !!card.live;
    fields['Linked At'] = (card && card.created) || new Date().toISOString();
    await upsert('Fidel Cards', fields, ['Card ID']);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('fidel-link', err);
    const msg = String(err && err.message);
    const m = msg.match(/: (\d{3}) /);
    const t = msg.match(/"type":"([A-Z_]+)"/);
    return res.status(500).json({ error: 'Save failed', status: m ? m[1] : undefined, type: t ? t[1] : undefined });
  }
};

module.exports._test = { fidelCard };
