#!/usr/bin/env node
// Refreshes SKYLIGHT_TOKEN by driving a real Chrome profile against app.ourskylight.com
// and reading the access token the app itself refreshes into Local Storage.
//
// Usage:
//   node refresh-token.js --login   (one-time, visible window — log in by hand)
//   node refresh-token.js           (headless — reuses the saved session)
require('dotenv').config();
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, '.browser-profile');
const ENV_PATH = path.join(__dirname, '.env');
const CHROME_PATH = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'https://app.ourskylight.com';
const AUTH_STORAGE_KEY = 'mmkv.default\\auth-storage';

const isLoginMode = process.argv.includes('--login');

async function extractToken(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw)?.state?.accessToken || null;
    } catch {
      return null;
    }
  }, AUTH_STORAGE_KEY);
}

function updateEnvToken(token) {
  let contents = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (/^SKYLIGHT_TOKEN=.*$/m.test(contents)) {
    contents = contents.replace(/^SKYLIGHT_TOKEN=.*$/m, `SKYLIGHT_TOKEN=${token}`);
  } else {
    contents += `${contents.endsWith('\n') || !contents ? '' : '\n'}SKYLIGHT_TOKEN=${token}\n`;
  }
  fs.writeFileSync(ENV_PATH, contents);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isLoginMode ? false : true,
    userDataDir: PROFILE_DIR,
    args: ['--window-size=1280,900'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    if (isLoginMode) {
      console.log('\n👉 A Chrome window has opened. Log into Skylight normally.');
      console.log('   Waiting up to 5 minutes for login to complete...\n');

      const deadline = Date.now() + 5 * 60 * 1000;
      let token = null;
      while (Date.now() < deadline) {
        token = await extractToken(page);
        if (token) break;
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!token) {
        console.error('❌ Timed out waiting for login. Run `npm run login` again.');
        process.exitCode = 1;
        return;
      }

      updateEnvToken(token);
      console.log('✅ Logged in — session saved and token written to .env.');
    } else {
      // Let the SPA's own silent-refresh logic run before we read the token back out.
      await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));

      const token = await extractToken(page);
      if (!token) {
        throw new Error(
          'No token in Local Storage — saved browser session may have expired. Run `npm run login` again.'
        );
      }

      updateEnvToken(token);
      console.log('✅ Token refreshed:', token.slice(0, 8) + '…');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('❌ Refresh failed:', e.message);
  process.exitCode = 1;
});
