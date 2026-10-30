// Tests for one-time link bonuses (cards via /api/fidel-link, banks via /api/link-bonus).
const assert = require('assert');
process.env.AIRTABLE_TOKEN = 't'; process.env.AIRTABLE_BASE_ID = 'b';
delete process.env.FIDEL_SECRET_KEY;

const db = { 'Fidel Cards': [], 'Points Adjustments': [] };
global.fetch = async (url, opts = {}) => {
  const table = decodeURIComponent(url.split('/v0/b/')[1].split('?')[0]);
  if (opts.method === 'PATCH') {
    const b = JSON.parse(opts.body); const f = b.records[0].fields; const key = b.performUpsert.fieldsToMergeOn[0];
    const i = db[table].findIndex((r) => r.fields[key] === f[key]);
    if (i >= 0) db[table][i].fields = { ...db[table][i].fields, ...f }; else db[table].push({ fields: f });
    return { ok: true, json: async () => ({}) };
  }
  const formula = new URL(url).searchParams.get('filterByFormula');
  let rows = db[table];
  let m;
  if ((m = formula.match(/^\{Bonus Key\} = "(.*)"$/))) rows = rows.filter((r) => r.fields['Bonus Key'] === m[1]);
  else if ((m = formula.match(/LOWER\(\{Email\}\) = "([^"]+)", LEFT\(\{Bonus Key\}, \d+\) = "([^"]+)"/))) {
    rows = rows.filter((r) => r.fields.Email === m[1] && String(r.fields['Bonus Key'] || '').startsWith(m[2]));
  }
  return { ok: true, json: async () => ({ records: rows }) };
};

const link = require('./api/fidel-link');
const bonus = require('./api/link-bonus');
function mkRes() { const r = { code: 0, body: null, headers: {} };
  r.status = (c) => (r.code = c, r); r.json = (b) => (r.body = b, r); r.end = () => r; r.setHeader = (k, v) => (r.headers[k] = v); return r; }
const call = async (fn, body) => { const r = mkRes(); await fn({ method: 'POST', headers: { origin: 'https://www.podovo.ai' }, body }, r); return r; };
const pts = (email) => db['Points Adjustments'].filter((r) => r.fields.Email === email).reduce((s, r) => s + r.fields.Points, 0);

(async () => {
  const A = 'a@example.com';
  const card = { cardId: 'c1c1c1c1-0000-4000-8000-000000000001', email: A, scheme: 'visa', last4: '4242' };
  let r = await call(link, card);
  assert.equal(r.code, 200); assert.equal(r.body.bonus, 100);
  r = await call(link, card); assert.equal(r.body.bonus, 0, 'same card again: no second bonus');
  r = await call(link, { ...card, cardId: 'c1c1c1c1-0000-4000-8000-000000000009' });
  assert.equal(r.body.bonus, 0, 'same card relinked with a new Fidel id: no second bonus');
  r = await call(link, { ...card, cardId: 'c1c1c1c1-0000-4000-8000-000000000002', last4: '5555', scheme: 'mastercard' });
  assert.equal(r.body.bonus, 100, 'a second card earns its own bonus');
  assert.equal(pts(A), 200);
  assert.equal(db['Points Adjustments'][0].fields.Label, 'Card linked bonus');

  r = await call(bonus, { email: A, type: 'bank', institution: 'Wells Fargo' }); assert.equal(r.body.bonus, 100);
  r = await call(bonus, { email: 'A@Example.com', type: 'bank', institution: 'wells  fargo' }); assert.equal(r.body.bonus, 0, 'same bank: once');
  r = await call(bonus, { email: A, type: 'bank', institution: 'Chase' }); assert.equal(r.body.bonus, 100);
  assert.equal(pts(A), 400);
  assert.equal((await call(bonus, { email: A, type: 'bank', institution: 'Unknown' })).code, 400);
  assert.equal((await call(bonus, { email: A, type: 'card', institution: 'X' })).code, 400);

  for (const b of ['B1', 'B2', 'B3', 'B4']) await call(bonus, { email: A, type: 'bank', institution: b });
  r = await call(bonus, { email: A, type: 'bank', institution: 'B5' });
  assert.equal(r.body.capped, true, 'max 5 bank bonuses per listener');
  assert.equal(pts(A), 200 + 5 * 100);

  // A failing bonus never breaks card linking.
  const saved = db['Points Adjustments']; delete db['Points Adjustments'];
  r = await call(link, { ...card, cardId: 'c1c1c1c1-0000-4000-8000-000000000003', last4: '1111' });
  assert.equal(r.code, 200); assert.equal(r.body.bonus, 0);
  db['Points Adjustments'] = saved;
  console.log('BONUS TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
