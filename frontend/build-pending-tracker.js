const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// An English-only static preview; never changes upstream's full localized build.
fs.writeFileSync('mempool-frontend-config.json', JSON.stringify({
  BASE_MODULE: 'mempool', MAINNET_ENABLED: true,
  TESTNET_ENABLED: false, TESTNET4_ENABLED: false, SIGNET_ENABLED: false,
  LIQUID_ENABLED: false, LIQUID_TESTNET_ENABLED: false,
  OFFICIAL_MEMPOOL_SPACE: false, MINING_DASHBOARD: true,
  ACCELERATOR: false, ACCELERATOR_BUTTON: false,
  WEBSOCKET_URL: 'wss://mempool.space{network}/api/v1/ws',
  PENDING_TRACKER_EXPLANATIONS: true,
}, null, 2));
execFileSync(process.execPath, ['generate-themes.js'], { stdio: 'inherit' });
execFileSync(process.execPath, ['generate-config.js'], { stdio: 'inherit' });
let index = fs.readFileSync('src/index.html', 'utf8');
index = index.replace('<title>mempool - Bitcoin Explorer</title>', '<title>Pending Tracker Test - Bitcoin Explorer</title>');
index = index.replace('</head>', '  <meta name="robots" content="noindex, nofollow">\n</head>');
if (process.env.VERCEL_URL && /^[a-zA-Z0-9.-]+$/.test(process.env.VERCEL_URL)) {
  index = index.replace('id="canonical" rel="canonical" href="https://mempool.space"', `id="canonical" rel="canonical" href="https://${process.env.VERCEL_URL}"`);
}
fs.writeFileSync('src/index.html', index);

execFileSync(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'build', '--configuration', 'production', '--localize=false'], { stdio: 'inherit' });
const output = 'dist/mempool/browser';
if (!fs.existsSync(`${output}/index.html`)) throw new Error('English browser output is missing');
fs.cpSync('src/resources', `${output}/resources`, { recursive: true });
fs.cpSync('.theme-build', output, { recursive: true });
console.log(`Pending Tracker preview ready at ${output}`);
