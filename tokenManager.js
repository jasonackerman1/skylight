const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ENV_PATH = path.join(__dirname, '.env');
const REFRESH_INTERVAL_MS = 90 * 60 * 1000; // ahead of the token's 2h lifespan

let currentToken = process.env.SKYLIGHT_TOKEN || null;
let refreshing = null; // in-flight promise so concurrent 401s share one refresh

function readTokenFromEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const match = fs.readFileSync(ENV_PATH, 'utf8').match(/^SKYLIGHT_TOKEN=(.*)$/m);
  return match ? match[1].trim() : null;
}

function refresh() {
  if (refreshing) return refreshing;

  refreshing = new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(__dirname, 'refresh-token.js')],
      { cwd: __dirname, timeout: 45000 },
      (err, stdout, stderr) => {
        refreshing = null;
        if (err) {
          console.error('❌ Token refresh failed:', stderr.trim() || err.message);
          return reject(err);
        }
        const token = readTokenFromEnvFile();
        if (!token) return reject(new Error('Refresh ran but no token found in .env'));
        currentToken = token;
        console.log(stdout.trim());
        resolve(currentToken);
      }
    );
  });

  return refreshing;
}

function getToken() {
  if (!currentToken) throw new Error('No token available yet. Run `npm run login` once to authenticate.');
  return currentToken;
}

function startAutoRefresh() {
  setInterval(() => {
    refresh().catch(() => {}); // failure already logged inside refresh()
  }, REFRESH_INTERVAL_MS);
}

module.exports = { getToken, refresh, startAutoRefresh };
