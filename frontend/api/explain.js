const TXID = /^[a-f0-9]{64}$/i;

function factsFor(tx) {
  const vsize = Math.ceil(tx.weight / 4);
  return {
    confirmed: tx.status.confirmed,
    blockHeight: tx.status.confirmed ? tx.status.block_height : null,
    feeSats: tx.fee,
    feeRate: vsize > 0 ? Number((tx.fee / vsize).toFixed(2)) : null,
    inputs: tx.vin.length,
    outputs: tx.vout.length,
    coinbase: tx.vin.some(input => input.is_coinbase),
  };
}

function explainFacts(facts) {
  const status = facts.confirmed
    ? `This Bitcoin transaction is confirmed in block ${facts.blockHeight.toLocaleString('en-US')}.`
    : 'This Bitcoin transaction is unconfirmed and waiting for a miner to include it in a block. Its confirmation time is not guaranteed.';
  if (facts.coinbase) return `${status} It creates a miner's block reward, so it is different from a normal payment and has no transaction fee.`;
  return `${status} It paid a network fee of ${facts.feeSats.toLocaleString('en-US')} sats (${facts.feeRate} sats per virtual byte). Its ${facts.outputs} outputs can include change returned to the sender; adding them together does not tell you the payment amount.`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  const { txid } = req.body || {};
  if (typeof txid !== 'string' || !TXID.test(txid)) return res.status(400).json({ error: 'Enter a valid Bitcoin transaction ID.' });
  // The browser supplies only an ID. Fetch facts here so injected claims never enter the prompt.
  try {
    const upstream = await fetch(`https://mempool.space/api/tx/${txid}`, { signal: AbortSignal.timeout(8000) });
    if (upstream.status === 404) return res.status(404).json({ error: 'Transaction not found on Bitcoin mainnet.' });
    if (!upstream.ok) throw new Error('upstream');
    const tx = await upstream.json();
    if (tx.txid !== txid.toLowerCase() || !Array.isArray(tx.vin) || !Array.isArray(tx.vout) || !tx.status || !Number.isFinite(tx.fee) || !Number.isFinite(tx.weight)) throw new Error('invalid data');
    const facts = factsFor(tx);
    const fallback = { explanation: explainFacts(facts), source: 'verified-facts', facts };
    // The factual explanation remains usable without an AI provider or during provider failures.
    if (!process.env.GROQ_API_KEY) return res.status(200).json(fallback);
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature: 0, max_tokens: 220,
          messages: [
            { role: 'system', content: 'Explain verified Bitcoin transaction facts in 2-3 concise sentences for a beginner. Use only the supplied facts. Do not invent identities, payment amounts, confirmations, safety claims, or confirmation time estimates. Outputs may include change. Coinbase transactions are miner rewards, not normal payments. Never offer investment advice.' },
            { role: 'user', content: JSON.stringify(facts) },
          ],
        }),
      });
      if (!response.ok) throw new Error('provider');
      const result = await response.json();
      const explanation = result.choices?.[0]?.message?.content?.trim();
      if (!explanation || explanation.length > 1800) throw new Error('provider output');
      return res.status(200).json({ explanation, source: 'ai', facts });
    } catch {
      return res.status(200).json(fallback);
    }
  } catch {
    return res.status(502).json({ error: 'Bitcoin data is temporarily unavailable. Try again shortly.' });
  }
};
module.exports.factsFor = factsFor;
module.exports.explainFacts = explainFacts;
