// GET /api/fidel-wallet?email=listener@example.com
// Returns the listener's linked cards, points totals and recent matched purchases
// for the Wallet page. Only card brand + last 4 digits are ever returned.
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID

const { find, q } = require('../lib/airtable');

const ALLOWED_ORIGINS = ['https://www.podovo.ai', 'https://podovo.ai'];

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.webflow\.io$/.test(origin);
  if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = String((req.query && req.query.email) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'email required' });

  try {
    const [cardRows, txRows] = await Promise.all([
      find('Fidel Cards', `AND(LOWER({Email}) = ${q(email)}, {Status} = "Linked")`, 20),
      find('Fidel Transactions', `LOWER({Email}) = ${q(email)}`, 500),
    ]);

    const cards = cardRows.map((r) => ({
      scheme: r.fields.Scheme || 'card',
      last4: r.fields.Last4 || '',
    }));

    const points = { pending: 0, confirmed: 0 };
    for (const r of txRows) {
      const p = Number(r.fields.Points || 0);
      if (r.fields.Status === 'Pending') points.pending += p;
      else points.confirmed += p; // Confirmed, plus Refunded (negative) entries
    }

    const transactions = txRows
      .map((r) => ({
        brand: r.fields.Brand || '',
        amount: Number(r.fields.Amount || 0),
        currency: r.fields.Currency || 'USD',
        points: Number(r.fields.Points || 0),
        status: r.fields.Status || 'Pending',
        datetime: r.fields.Datetime || '',
      }))
      .sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)))
      .slice(0, 20);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ cards, points, transactions });
  } catch (err) {
    console.error('fidel-wallet', err);
    // Say which setting is wrong, never its value.
    const missing = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID'].filter((k) => !process.env[k]);
    const m = String(err && err.message).match(/: (\d{3}) /);
    const reason = missing.length
      ? `missing ${missing.join(', ')}`
      : m && m[1] === '401' ? 'Airtable token rejected'
      : m && m[1] === '403' ? 'Airtable token lacks access to this base or scope'
      : m && m[1] === '404' ? 'Airtable base or table not found'
      : 'Airtable request failed';
    return res.status(500).json({ error: 'Lookup failed', reason });
  }
};
