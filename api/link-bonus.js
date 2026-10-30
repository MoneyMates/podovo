// POST /api/link-bonus  { email, type: "bank", institution }
// Called by the Wallet page after a bank account is connected through Plaid.
// Adds a one-time points bonus per bank (Points Adjustments table). Bank links
// are only known to the browser today, so this is capped per listener to limit
// abuse. Card bonuses are added server-side by /api/fidel-link instead.
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, LINK_BONUS_POINTS (default 100),
//      MAX_BANK_BONUSES (default 5)

const { awardOnce, countBonuses, linkBonusPoints, bankKey } = require('../lib/bonus');

const ALLOWED_ORIGINS = ['https://www.podovo.ai', 'https://podovo.ai'];

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.webflow\.io$/.test(origin);
  if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = readJson(req);
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  const email = String(body.email || '').trim().toLowerCase();
  const institution = String(body.institution || '').trim().slice(0, 80);
  if (!email.includes('@')) return res.status(400).json({ error: 'email required' });
  if (body.type !== 'bank') return res.status(400).json({ error: 'type must be bank' });
  if (!institution || /^(unknown|your bank)$/i.test(institution)) {
    return res.status(400).json({ error: 'institution required' });
  }

  try {
    const max = Number(process.env.MAX_BANK_BONUSES) || 5;
    if ((await countBonuses(email, 'bank')) >= max) return res.status(200).json({ ok: true, bonus: 0, capped: true });
    const points = linkBonusPoints();
    const added = await awardOnce({
      key: bankKey(email, institution),
      email,
      points,
      label: 'Bank linked bonus',
      reason: `Connected ${institution}`,
    });
    return res.status(200).json({ ok: true, bonus: added ? points : 0 });
  } catch (err) {
    console.error('link-bonus', err);
    return res.status(500).json({ error: 'Bonus failed' });
  }
};
