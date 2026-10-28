const assert = require('assert');
const http = require('http');
const { Readable } = require('stream');
process.env.FIDEL_WEBHOOK_SECRET = 'whsec_test';
process.env.AIRTABLE_TOKEN = 't'; process.env.AIRTABLE_BASE_ID = 'b';
process.env.POINTS_PER_DOLLAR = '5'; process.env.FIDEL_SECRET_KEY = 'sk_test_x';
// fake Airtable + Fidel
const db = { 'Fidel Cards': [], 'Fidel Transactions': [] };
global.fetch = async (url, opts = {}) => {
  if (url.startsWith('https://api.fidel.uk')) return { ok: true, json: async () => ({ items: [{ metadata: { id: 'Listener@Example.com' } }] }) };
  const table = decodeURIComponent(url.split('/v0/b/')[1].split('?')[0]);
  if (opts.method === 'PATCH') {
    const b = JSON.parse(opts.body); const f = b.records[0].fields; const key = b.performUpsert.fieldsToMergeOn[0];
    const i = db[table].findIndex(r => r.fields[key] === f[key]);
    if (i >= 0) db[table][i].fields = { ...db[table][i].fields, ...f }; else db[table].push({ fields: f });
    return { ok: true, json: async () => ({}) };
  }
  // naive filter: return all rows whose Email/Card ID appear in formula
  const formula = new URL(url).searchParams.get('filterByFormula');
  const rows = db[table].filter(r => Object.values(r.fields).some(v => typeof v === 'string' && v && formula.toLowerCase().includes(`"${v.toLowerCase()}"`)));
  return { ok: true, json: async () => ({ records: rows }) };
};
const hook = require('./api/fidel-webhook');
const wallet = require('./api/fidel-wallet');
const { expectedSignature, classify } = hook._test;

function mkRes() { const r = { code: 0, body: null, headers: {} };
  r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.end = () => r; r.setHeader = (k, v) => (r.headers[k] = v); return r; }
async function post(obj, { badSig = false, oldTs = false } = {}) {
  const raw = JSON.stringify(obj); const ts = String(Date.now() - (oldTs ? 10 * 60e3 : 0));
  const url = 'https://podovo-api.vercel.app/api/fidel-webhook';
  const req = Readable.from([raw]); req.setEncoding = () => {}; req.method = 'POST'; req.url = '/api/fidel-webhook';
  req.headers = { host: 'podovo-api.vercel.app', 'x-fidel-timestamp': ts, 'x-fidel-signature': badSig ? 'nope' : expectedSignature('whsec_test', raw, url, ts) };
  const res = mkRes(); await hook(req, res); return res;
}
(async () => {
  assert.equal(classify({ id: 'c1', scheme: 'visa', lastNumbers: '4004' }).kind, 'card-linked');
  assert.equal(classify({ event: 'card.failed', card: { id: 'c9' } }).kind, 'card-failed');
  assert.equal((await post({ id: 'c1' }, { badSig: true })).code, 401);
  assert.equal((await post({ id: 'c1' }, { oldTs: true })).code, 401);
  let r = await post({ id: 'c1', scheme: 'visa', lastNumbers: '4004', live: false });
  assert.equal(r.code, 200); assert.equal(r.body.kind, 'card-linked');
  assert.equal(db['Fidel Cards'][0].fields.Email, 'listener@example.com');
  r = await post({ id: 't1', amount: 12.4, currency: 'USD', auth: true, cleared: false, card: { id: 'c1' }, brand: { name: 'Corner Coffee' }, datetime: '2026-10-27T10:00:00Z' });
  assert.equal(r.body.kind, 'auth');
  r = await post({ id: 't1', amount: 12.4, currency: 'USD', auth: false, cleared: true, card: { id: 'c1' }, brand: { name: 'Corner Coffee' }, datetime: '2026-10-27T10:00:00Z' });
  assert.equal(r.body.kind, 'clearing'); assert.equal(db['Fidel Transactions'].length, 1, 'clearing updates same row');
  r = await post({ id: 't2', amount: -5, currency: 'USD', card: { id: 'c1', metadata: { id: 'listener@example.com' } }, brand: { name: 'Corner Coffee' }, originalTransactionId: 't1', datetime: '2026-10-28T10:00:00Z' });
  assert.equal(r.body.kind, 'refund');
  const wr = mkRes(); await wallet({ method: 'GET', headers: { origin: 'https://www.podovo.ai' }, query: { email: 'Listener@example.com' } }, wr);
  assert.equal(wr.code, 200); console.log(JSON.stringify(wr.body), wr.headers['Access-Control-Allow-Origin']);
  assert.deepEqual(wr.body.cards, [{ scheme: 'visa', last4: '4004' }]);
  assert.deepEqual(wr.body.points, { pending: 0, confirmed: 62 - 25 });
  const bad = mkRes(); await wallet({ method: 'GET', headers: { origin: 'https://evil.com' }, query: { email: 'x' } }, bad);
  assert.equal(bad.code, 400); assert.equal(bad.headers['Access-Control-Allow-Origin'], undefined);
  console.log('ALL TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
