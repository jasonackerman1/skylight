require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://app.ourskylight.com';

let _frameId = process.env.SKYLIGHT_FRAME_ID || null;

// ── Token resolution ──────────────────────────────────────────────────────────
// If SKYLIGHT_TOKEN is set in .env, use it directly (no auth call needed).
// This is the reliable path — grab the token from app.ourskylight.com DevTools.
function getToken() {
  if (process.env.SKYLIGHT_TOKEN) return process.env.SKYLIGHT_TOKEN;
  throw new Error(
    'No token found. Add SKYLIGHT_TOKEN=<your token> to your .env file.\n' +
    '  How to get it: log into app.ourskylight.com in Chrome, open DevTools → Network,\n' +
    '  click any request, and copy the "Authorization: Bearer <token>" value.'
  );
}

async function getFrameId(token) {
  if (_frameId) return _frameId;

  const res = await fetch(`${BASE}/api/frames`, { headers: skyHeaders(token) });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new Error('Token expired or invalid. Grab a fresh token from app.ourskylight.com DevTools and update SKYLIGHT_TOKEN in your .env.');
    }
    throw new Error(`Frames request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const frames = data?.data ?? data;

  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('No frames found for this account');
  }

  _frameId = frames[0].id;
  const name = frames[0].attributes?.name ?? frames[0].name ?? 'Unknown';
  console.log(`📋 Frame: "${name}" (${_frameId})`);
  return _frameId;
}

function skyHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Origin': 'https://app.ourskylight.com',
    'Referer': 'https://app.ourskylight.com/',
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/calendar', async (req, res) => {
  try {
    const token = getToken();
    const frameId = await getFrameId(token);
    const tz = process.env.SKYLIGHT_TIMEZONE ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;

    const { date_min, date_max } = req.query;
    if (!date_min || !date_max) {
      return res.status(400).json({ error: 'date_min and date_max required' });
    }

    const url = `${BASE}/api/frames/${frameId}/calendar_events` +
      `?date_min=${date_min}&date_max=${date_max}&timezone=${encodeURIComponent(tz)}`;

    const r = await fetch(url, { headers: skyHeaders(token) });
    if (r.status === 401) {
      _frameId = null; // reset so next request re-fetches
      return res.status(401).json({ error: 'Token expired. Update SKYLIGHT_TOKEN in your .env and restart.' });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('❌ Calendar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/members', async (req, res) => {
  try {
    const token = getToken();
    const frameId = await getFrameId(token);

    const r = await fetch(`${BASE}/api/frames/${frameId}/categories`, {
      headers: skyHeaders(token),
    });
    if (r.status === 401) {
      return res.status(401).json({ error: 'Token expired. Update SKYLIGHT_TOKEN in your .env and restart.' });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('❌ Members:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🗓  Skylight Custom Calendar`);
  console.log(`   → http://localhost:${PORT}\n`);

  try {
    const token = getToken();
    console.log('✅ Token found in .env');
    await getFrameId(token);
  } catch (e) {
    console.warn(`⚠️  ${e.message}`);
  }
});
