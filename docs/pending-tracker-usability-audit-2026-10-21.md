# Bitcoin explorer usability audit — 21 October 2026

Scope: Bitcoin network, transaction and single-address lookup, desktop preview only.

## Findings and decisions

| Observed need | Evidence | Product decision |
|---|---|---|
| Explain status before technical detail | Blockstream transaction guide; Coinbase troubleshooting | Keep status/confirmation, timing, fee and amount in Snapshot. Add one state-aware next step. |
| Confirmed does not mean credited by an exchange | Coinbase support | Confirmed guidance points to address/network checks and recipient confirmation policy. No universal 6-confirmation guarantee. |
| Explorer totals differ from payment amount and wallet balance | Trezor change-address guide; Trezor user forum | Keep output/change qualifications. Show both pending receipt and spent-output directions when a net hides them. Do not guess a recipient or owner. |
| People confuse fee amount and fee rate | Mempool FAQ; BitcoinBeginners discussion | Retain sats, current USD and sat/vB as different quantities. No invented average fee or guaranteed confirmation deadline. |
| Missing transaction can mean not broadcast, wrong ID or provider differences | User reports; Coinbase and Blockstream guides | Add practical not-found help; invalid searches show an explanation rather than failing silently. |
| Dense dashboards need progressive disclosure | Nielsen Norman Group | Preserve compact Snapshots and full Dive Deeper content. Remove the fee-choice question duplicated by the Sending Bitcoin planner. |
| Small muted actions are easy to miss | WCAG contrast guidance | Brighten help actions and enlarge targets without making headings compete with values. Preserve approved palette. |

## Competitor assessment

Mempool is strongest at projected blocks, mempool/fee context and interactive transaction flow. Blockstream emphasizes direct lookup, status, input/output accounting and fee data. Blockchain.com exposes broad network statistics and address lookup, but those extra market and aggregate metrics are not necessary to answer a missing-payment question. Preserve the underlying visualizations; prioritize understanding and next actions rather than adding every available statistic.

The existing Snapshots already cover the essential transaction and single-address facts. Hash rate, difficulty and lifetime accounting belong in secondary sections, not the initial payment-status summary. A large backlog alone is not evidence of network failure. A public address is not an entire wallet or verified identity.

## Sources

- https://mempool.space/docs/faq
- https://blockstream.info/
- https://help.blockstream.com/education/wallets/managing-and-acquiring-bitcoin/how-do-i-look-up-my-bitcoin-transaction
- https://www.blockchain.com/explorer
- https://www.blockchain.com/explorer/addresses/btc/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
- https://help.coinbase.com/en/coinbase/trading-and-funding/cryptocurrency-trading-pairs/send-and-receive-troubleshooting
- https://help.coinbase.com/en/coinbase/getting-started/crypto-education/glossary/confirmations
- https://trezor.io/learn/supported-assets/bitcoin/what-is-a-change-address
- https://forum.trezor.io/t/discrepancy-trezor-wallet-transaction-details-vs-trezor-bitcoin-explorer-transaction-details-hacked/20688
- https://www.reddit.com/r/BitcoinBeginners/comments/1758vkb
- https://www.reddit.com/r/Bitcoin/comments/1d8lu7q
- https://www.nngroup.com/articles/progressive-disclosure/
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

User discussions are qualitative examples, not prevalence statistics. Some explorer pages are client rendered; source/support documentation supplemented retrieved page content. Contrast adjustments are targeted improvements, not a claim of complete WCAG conformance. Live notification delivery and iPhone validation remain separate work; no new background notification service was added.
