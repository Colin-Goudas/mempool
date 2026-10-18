# Pending Tracker / Mempool Angular test

This branch is an isolated experiment using the real Mempool Angular frontend. It does not replace the Next.js Pending Tracker site. Never merge it into `master`, change Ethereum, or attach `pendingtracker.com` without approval.

## Product direction and snapshot layout (October 18 update)

Angular is the intended stronger foundation for Pending Tracker's **Bitcoin explorer, transaction and wallet/address pages**. It is not limited to being an advanced side product. The existing homepage and Ethereum pages remain outside this migration. Keep all work on `pending-tracker-explorer-test` and the separate test project until approval to switch.

The three mainnet pages now share a compact Mempool-style snapshot: identifier/title, short summary inside the same panel above the first fact, then vertically stacked fact/value rows on the left with one or two explanatory sentences on the right. Each explanation has its own native **Explore more** disclosure. Both columns remain side by side at narrow widths. Mempool's block visualization and original detailed explorer components remain available below/above their existing routes.

The transaction page automatically requests its summary and can fall back to its displayed facts. Confirmed/pending/replaced/coinbase states, UTC timestamps, fee rate rounded using virtual size and missing data are handled explicitly. A full-detail mobile transaction route is preserved for the preview rather than automatically switching to Mempool's compact status tracker. An explicit `?mode=status` can still request the original tracker.

Address summaries identify one address rather than claiming to show a whole wallet. Received/spent totals are confirmed-output totals rather than income/payment claims. Network summaries reuse live WebSocket state and label reconnecting or missing data.

Focused tests: `cd frontend && node --test scripts/test-snapshot.cjs scripts/explain.test.js` (ten passing tests, including pending-to-replaced summary invalidation). Optimized Angular build passes; existing upstream style-budget warnings remain. The unlinked `resources/snapshot-mobile-check.html` page provides an embedded 390px viewport for preview QA; this is not a physical iPhone test.

## Verified on October 18, 2026

- Installed the locked frontend dependencies and built the optimized Angular application successfully. The English-only build took about 40 seconds locally; initial JavaScript/CSS was about 1.86 MB raw / 412 KB estimated transfer. Existing upstream component-style budget warnings remain.
- Commit `31afb57fa7f2c1d3bb3dea77f0f441da0983c025` deployed successfully to the separate Vercel project `pendingtracker-angular-test`, ID `prj_jnAw4my56tOFmaTJsB4JjDIt4kbk`.
- Verified deployment: https://pendingtracker-angular-test-9symoq7mw-pending-tracker.vercel.app (Vercel Authentication may apply).
- Deployed HTTP checks passed: runtime config JavaScript, proxied fee recommendations, tip height, mining hashrate, genesis address, genesis transaction, and a transaction deep-link returning the Angular HTML shell. `/api/explain` GET correctly returns 405 JSON from our own function.
- Direct WSS handshake to `wss://mempool.space/api/v1/ws` with the preview's Origin succeeded. Sending `{"action":"init"}` returned eight blocks, eight projected mempool blocks, transactions, fees, difficulty adjustment, conversions, and mempool information.
- Five automated server explanation tests pass: invalid request/method rejection, rounded virtual size, change-output caveat, coinbase reward handling, authoritative-data fetching and provider-free fallback, missing transaction, and upstream failures.

- Browser checks also passed: live dashboard, transaction deep-link, and the explanation button's deployed POST. For transaction `c5908e04...db1c8c`, the summary matched block 900000, fee 3440 sats, fee rate 8.25 sats/vB and eight outputs with the change caveat. It was correctly labeled as a verified-data summary.

These checks do not prove every explorer screen, wallet feature, or mobile interaction works.

## Build and routing

Use `cd frontend && npm ci --ignore-scripts && node build-pending-tracker.js`.

`build-pending-tracker.js` preserves the upstream full localized build script. It generates a mainnet-only test config, builds an optimized English application, and copies checked-in resources/theme assets without requiring rsync or downloading upstream promotional videos. `frontend/vercel.json` assumes Vercel Root Directory `frontend` and serves `dist/mempool/browser`.

REST paths are rewritten to the existing public Mempool Bitcoin backend. WSS connects directly to that backend using the optional `WEBSOCKET_URL` config. It does not use a Vercel WebSocket proxy. Unset `WEBSOCKET_URL` to restore upstream same-origin behavior. Mining pool logo resources are also routed to their upstream location when absent locally.

No Bitcoin node or Mempool backend is deployed here. Public infrastructure is suitable for limited compatibility testing; do not assume permission, capacity guarantees, or commercial service terms for a launched product. Evaluate a compatible hosted service agreement or self-hosted backend before scaling.

## Design and explanations

The gold Sass theme, Pending Tracker test identity, system typography, compact responsive banner, and transaction explanation section preserve the upstream explorer components and fee/status colors. This is an initial adaptation, not design parity with the Next.js version. Upstream attribution, source link and license notices remain.

On mainnet transaction pages, `Explain this transaction` calls our server function with only the transaction ID. The function fetches and validates current Bitcoin facts itself. With a server-only `GROQ_API_KEY`, it requests a short AI explanation (`GROQ_MODEL` is optional). Without that key, or if the provider fails, it returns a clearly labeled factual summary. No provider key was copied from production and live AI-provider output has not been verified. Summaries do not infer payment amounts from total outputs or promise confirmation times.

Run focused tests with `node --test frontend/scripts/explain.test.js`.

## Remaining validation

- Broader browser interaction checks for address, block, mempool, mining and wallet screens; iPhone visual/interaction testing remains unverified.
- AI-provider verification with an isolated preview credential (the deployed factual-summary POST is verified).
- Remote backend feature/version compatibility and production hosting/service agreement.
- Full Pending Tracker design adaptation and comparison against the original app.

Preserve AGPL-3.0 licensing and upstream attribution. Never promote an experiment into the live website automatically.
