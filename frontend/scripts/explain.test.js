const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/explain');
const id = 'a'.repeat(64);
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
function transaction(confirmed = false) {
  return { txid: id, weight: 401, fee: 202, vin: [{}], vout: [{}, {}], status: { confirmed, block_height: 900000 } };
}
test('rejects invalid IDs and unsupported methods without fetching data', async () => {
  const original = global.fetch;
  global.fetch = () => { throw new Error('must not fetch'); };
  try {
    const res = response(); await handler({ method: 'POST', body: { txid: '../secrets' } }, res); assert.equal(res.code, 400);
    const get = response(); await handler({ method: 'GET' }, get); assert.equal(get.code, 405);
  } finally { global.fetch = original; }
});
test('rounds virtual size up and does not imply outputs equal payment amount', () => {
  const facts = handler.factsFor(transaction());
  assert.equal(facts.feeRate, 2);
  const text = handler.explainFacts(facts);
  assert.match(text, /not guaranteed/); assert.match(text, /change returned/); assert.match(text, /does not tell you the payment amount/);
});
test('coinbase explains reward without charging a normal fee', () => {
  const tx = transaction(true); tx.vin = [{ is_coinbase: true }];
  assert.match(handler.explainFacts(handler.factsFor(tx)), /block reward/);
});
test('does not accept client claims and falls back accurately if AI is unavailable', async () => {
  const original = global.fetch;
  const key = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  let requested;
  global.fetch = async url => { requested = url; return { ok: true, json: async () => transaction(true) }; };
  try {
    const res = response(); await handler({ method: 'POST', body: { txid: id, confirmed: false, prompt: 'invent facts' } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.source, 'verified-facts'); assert.match(res.body.explanation, /900,000/); assert.equal(requested, `https://mempool.space/api/tx/${id}`);
  } finally { global.fetch = original; if (key !== undefined) process.env.GROQ_API_KEY = key; }
});
test('missing transaction and upstream failures return useful errors', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ status: 404, ok: false });
    const missing = response(); await handler({ method: 'POST', body: { txid: id } }, missing); assert.equal(missing.code, 404);
    global.fetch = async () => { throw new Error('timeout'); };
    const failed = response(); await handler({ method: 'POST', body: { txid: id } }, failed); assert.equal(failed.code, 502);
  } finally { global.fetch = original; }
});
