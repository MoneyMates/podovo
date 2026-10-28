// Minimal Airtable REST helper (no SDK needed).
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID
const API = 'https://api.airtable.com/v0';

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function tableUrl(table) {
  return `${API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

// Create-or-update one record, matched on the given unique field(s).
async function upsert(table, fields, mergeOn) {
  const res = await fetch(tableUrl(table), {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: mergeOn },
      records: [{ fields }],
      typecast: true,
    }),
  });
  if (!res.ok) throw new Error(`Airtable upsert ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Read records matching an Airtable formula (follows pagination).
async function find(table, formula, max = 500) {
  const out = [];
  let offset;
  do {
    const qs = new URLSearchParams({ filterByFormula: formula, pageSize: '100' });
    if (offset) qs.set('offset', offset);
    const res = await fetch(`${tableUrl(table)}?${qs}`, { headers: headers() });
    if (!res.ok) throw new Error(`Airtable find ${table}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...data.records);
    offset = data.offset;
  } while (offset && out.length < max);
  return out;
}

// Escape a value for use inside an Airtable formula string literal.
function q(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

module.exports = { upsert, find, q };
