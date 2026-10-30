// One-time points bonuses (e.g. for linking a card or bank account).
// Each bonus is a row in the Airtable "Points Adjustments" table with a unique
// "Bonus Key", so the same card or bank account never earns it twice — even if
// it's unlinked and linked again, or the request is retried.
//
// Env: LINK_BONUS_POINTS (default 100)

const { find, upsert, q } = require('./airtable');

const TABLE = 'Points Adjustments';

function linkBonusPoints() {
  const n = Number(process.env.LINK_BONUS_POINTS);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 100;
}

// Returns true if the bonus was added now, false if it already existed.
async function awardOnce({ key, email, points, label, reason }) {
  const existing = await find(TABLE, `{Bonus Key} = ${q(key)}`, 1);
  if (existing.length) return false;
  await upsert(
    TABLE,
    {
      'Bonus Key': key,
      Email: email,
      Points: points,
      Label: label,
      Reason: reason,
      'Added By': 'Podovo (automatic)',
      Date: new Date().toISOString(),
      Active: true,
    },
    ['Bonus Key']
  );
  return true;
}

// How many bonuses of one kind ("card" / "bank") this listener already has.
async function countBonuses(email, kind) {
  const rows = await find(
    TABLE,
    `AND(LOWER({Email}) = ${q(email)}, LEFT({Bonus Key}, ${kind.length + 1}) = ${q(kind + ':')})`,
    100
  );
  return rows.length;
}

function cardKey(email, cardId, scheme, last4) {
  return last4
    ? `card:${email}:${String(scheme || 'card').toLowerCase()}:${last4}`
    : `card:${email}:${cardId}`;
}

function bankKey(email, institution) {
  const name = String(institution || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `bank:${email}:${name}`;
}

module.exports = { awardOnce, countBonuses, linkBonusPoints, cardKey, bankKey };
