const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Standalone English Angular release. No Next.js runtime or proxy.
const publicBuild = process.env.VERCEL_ENV === 'production';
fs.writeFileSync('mempool-frontend-config.json', JSON.stringify({
  BASE_MODULE: 'mempool', MAINNET_ENABLED: true,
  TESTNET_ENABLED: false, TESTNET4_ENABLED: false, SIGNET_ENABLED: false,
  LIQUID_ENABLED: false, LIQUID_TESTNET_ENABLED: false,
  OFFICIAL_MEMPOOL_SPACE: false, MINING_DASHBOARD: true,
  ACCELERATOR: false, ACCELERATOR_BUTTON: false,
  WEBSOCKET_URL: 'wss://mempool.space{network}/api/v1/ws',
  PENDING_TRACKER_EXPLANATIONS: true,
  PENDING_TRACKER_REVIEW_TOOLS: !publicBuild,
}, null, 2));
execFileSync(process.execPath, ['generate-themes.js'], { stdio: 'inherit' });
execFileSync(process.execPath, ['generate-config.js'], { stdio: 'inherit' });
let index = fs.readFileSync('src/index.html', 'utf8');
index = index.replace('<title>mempool - Bitcoin Explorer</title>', '<title>Pending Tracker - Blockchain Explorer</title>');
if (!publicBuild) index = index.replace('</head>', '  <meta name="robots" content="noindex, nofollow">\n</head>');
index = index.replace('id="canonical" rel="canonical" href="https://mempool.space"', 'id="canonical" rel="canonical" href="https://pendingtracker.com"');
fs.writeFileSync('src/index.html', index);

execFileSync(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'build', '--configuration', 'production', '--localize=false', '--base-href=/'], { stdio: 'inherit' });
const output = 'dist/mempool/browser';
if (!fs.existsSync(`${output}/index.html`)) throw new Error('English browser output is missing');
fs.cpSync('src/resources', `${output}/resources`, { recursive: true });
fs.cpSync('.theme-build', output, { recursive: true });
console.log(`Pending Tracker preview ready at ${output}`);

fs.writeFileSync(`${output}/robots.txt`, publicBuild ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(`${output}/retired.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page unavailable — Pending Tracker</title><body style="background:#09090b;color:#e4e4e7;font:16px system-ui;padding:12vh 8vw"><h1>This page is not available.</h1><p>Use the new Pending Tracker explorer.</p><a style="color:#e4e4e7" href="/">Go to Pending Tracker →</a></body></html>');
