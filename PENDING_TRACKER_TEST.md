# Pending Tracker / Mempool Angular test

This branch is an **isolated experiment** based on the real Mempool Angular frontend. It does not replace the Next.js Pending Tracker production site.

## Current state

- Started a dark/gold theme by changing Sass tokens in `frontend/src/styles.scss`.
- No successful Angular build or public deployment has been verified yet.
- The fork contains Mempool's backend source, but the backend is **not** deployed by this branch.
- No claim of complete functionality is made without testing.

## Important backend dependency

Mempool's Angular frontend expects same-origin HTTP API paths and a WebSocket at `/api/v1/ws` (see `frontend/src/app/services/websocket.service.ts`). Merely pointing REST calls at the public Mempool API will not establish WebSocket support. Any separate static frontend deployment needs a compatible HTTPS and WSS routing strategy and permission to use the remote services. Full self-hosted backend requires Bitcoin Core RPC and a compatible Electrum/Esplora indexing service; it is not required to start testing frontend UI.

## Isolated deployment plan

1. Build the Angular application from `frontend/`, using its actual package scripts and required build assets. Test the build locally or in CI first.
2. Create a separate Vercel project for this fork, **never** reuse the production Pending Tracker Vercel project. Point it at this development branch only.
3. Verify runtime REST calls, WebSocket connection, browser navigation/deep links, and CORS/proxy behavior. Do not publish a test URL as working until these checks pass.
4. Check transaction, address, block, fee, and mempool views against known mainnet examples.
5. Match Pending Tracker's established Bitcoin design and add the plain-English explanations without replacing Mempool's explorer capabilities.
6. Review AGPL-3.0 obligations and preserve upstream notices and attribution.

## Safety

Never merge this branch into `master` or into `gbahnan/pendingtracker` automatically. Do not alter `pendingtracker.com`, its production deployment, or Ethereum routes.
