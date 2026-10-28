// POST /api/fidel-webhook
// Receives Fidel API webhooks for the Podovo program: card.linked, card.failed,
// transaction.auth, transaction.clearing and transaction.refund.
// Register this one URL in the Fidel dashboard for each of those events.
//
// Env:
//   FIDEL_WEBHOOK_SECRET  secretKey Fidel shows for the webhook (same URL for every event)
//   FIDEL_SECRET_KEY      Fidel secret API key (sk_test_... / sk_live_...), used to look up
//                         which Podovo user a card belongs to
//   FIDEL_WEBHOOK_URL     optional: the exact registered URL, if it differs from the request URL
//   POINTS_PER_DOLLAR     points per $1 spent at a partner brand (Podovo sets this; default 1)
//   AIRTABLE_TOKEN, AIRTABLE_BASE_ID

const crypto = require('crypto');
const { upsert, find, q } = require('../lib/airtable');

const CARDS = 'Fidel Cards';
const TXNS = 'Fidel Transactions';
const MAX_AGE_MS = 5 * 60 * 1000;

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Fidel signs: HMAC-SHA256(secret, rawBody + webhookUrl + timestamp) -> base64,
// then HMAC-SHA256(secret, thatBase64) -> base64.
function expectedSignature(secret, raw, url, ts) {
  const first = crypto.createHmac('sha256', secret).update(raw + url + ts).digest('base64');
  return crypto.createHmac('sha256', secret).update(first).digest('base64');
}

function requestUrl(req) {
  if (process.env.FIDEL_WEBHOOK_URL) return process.env.FIDEL_WEBHOOK_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}${req.url}`;
}

function signatureOk(req, raw) {
  const secret = process.env.FIDEL_WEBHOOK_SECRET;
  const sig = req.headers['x-fidel-signature'];
  const ts = req.headers['x-fidel-timestamp'];
  if (!secret || !sig || !ts) return false;
  const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_AGE_MS) return false;
  const a = Buffer.from(expectedSignature(secret, raw, requestUrl(req), ts));
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Fidel posts the entity itself (no event name), so tell events apart by shape.
function classify(body) {
  if (body.event === 'card.failed') return { kind: 'card-failed', entity: body.card || {} };
  if (body.card && body.amount !== undefined) {
    const amount = Number(body.amount);
    if (amount < 0 || body.originalTransactionId) return { kind: 'refund', entity: body };
    return { kind: body.cleared ? 'clearing' : 'auth', entity: body };
  }
  if (body.id && body.scheme && body.lastNumbers !== undefined) return { kind: 'card-linked', entity: body };
  return { kind: 'other', entity: body };
}

function pointsFor(amount) {
  const rate = Number(process.env.POINTS_PER_DOLLAR || 1);
  return Math.round(Number(amount || 0) * rate);
}

// The Podovo user's email travels as card metadata.id (set by the Wallet page).
// card.linked webhooks don't include metadata, so fetch the card from Fidel.
async function fidelCardEmail(cardId) {
  const key = process.env.FIDEL_SECRET_KEY;
  if (!key || !cardId) return '';
  const res = await fetch(`https://api.fidel.uk/v1/cards/${encodeURIComponent(cardId)}`, {
    headers: { 'Fidel-Key': key, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return '';
  const data = await res.json();
  const card = (data.items && data.items[0]) || data;
  return String((card.metadata && card.metadata.id) || '').toLowerCase();
}

async function emailForCard(card) {
  const fromPayload = card && card.metadata && card.metadata.id;
  if (fromPayload) return String(fromPayload).toLowerCase();
  const rows = await find(CARDS, `{Card ID} = ${q(card.id)}`, 1);
  if (rows[0] && rows[0].fields.Email) return rows[0].fields.Email;
  return fidelCardEmail(card.id);
}

async function saveCard(card, status) {
  await upsert(
    CARDS,
    {
      'Card ID': card.id,
      Email: await fidelCardEmail(card.id),
      Scheme: card.scheme || '',
      Last4: card.lastNumbers || '',
      Status: status,
      'Linked At': card.created || card.updated || new Date().toISOString(),
      Live: !!card.live,
    },
    ['Card ID']
  );
}

async function saveTransaction(kind, tx) {
  const status = kind === 'refund' ? 'Refunded' : kind === 'clearing' ? 'Confirmed' : 'Pending';
  await upsert(
    TXNS,
    {
      'Transaction ID': tx.id,
      'Card ID': tx.card.id || '',
      Email: await emailForCard(tx.card),
      Brand: (tx.brand && tx.brand.name) || '',
      Amount: Number(tx.amount || 0),
      Currency: tx.currency || '',
      Status: status,
      Points: pointsFor(tx.amount), // refunds carry a negative amount
      Datetime: tx.datetime || new Date().toISOString(),
      'Original Transaction ID': tx.originalTransactionId || '',
    },
    ['Transaction ID']
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = await readRaw(req);
  if (!signatureOk(req, raw)) return res.status(401).json({ error: 'Bad signature' });

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON' });
  }

  const { kind, entity } = classify(body);
  try {
    if (kind === 'card-linked') await saveCard(entity, 'Linked');
    else if (kind === 'card-failed') await saveCard(entity, 'Failed');
    else if (kind === 'auth' || kind === 'clearing' || kind === 'refund') await saveTransaction(kind, entity);
    return res.status(200).json({ ok: true, kind });
  } catch (err) {
    console.error('fidel-webhook', kind, err);
    // Non-2xx makes Fidel retry; upserts keyed on IDs keep retries safe.
    return res.status(500).json({ error: 'Processing failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
module.exports._test = { expectedSignature, classify, pointsFor };
