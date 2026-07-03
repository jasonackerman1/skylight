require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const tokenManager = require('./tokenManager');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://app.ourskylight.com';

let _frameId = process.env.SKYLIGHT_FRAME_ID || null;

async function getFrameId(token) {
  if (_frameId) return _frameId;

  const res = await fetch(`${BASE}/api/frames`, { headers: skyHeaders(token) });

  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text();
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

// Runs work(token) against the Skylight API; on a 401, refreshes the token
// once (via the saved browser session) and retries the same work.
async function withAuth(work) {
  const token = tokenManager.getToken();
  try {
    return await work(token);
  } catch (e) {
    if (e.status !== 401) throw e;
    console.log('🔄 Token expired mid-request — refreshing...');
    _frameId = null;
    const freshToken = await tokenManager.refresh();
    return work(freshToken);
  }
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
    const { date_min, date_max } = req.query;
    if (!date_min || !date_max) {
      return res.status(400).json({ error: 'date_min and date_max required' });
    }

    const data = await withAuth(async (token) => {
      const frameId = await getFrameId(token);
      const tz = process.env.SKYLIGHT_TIMEZONE ||
        Intl.DateTimeFormat().resolvedOptions().timeZone;

      const url = `${BASE}/api/frames/${frameId}/calendar_events` +
        `?date_min=${date_min}&date_max=${date_max}&timezone=${encodeURIComponent(tz)}`;

      const r = await fetch(url, { headers: skyHeaders(token) });
      if (r.status === 401) {
        const err = new Error('unauthorized');
        err.status = 401;
        throw err;
      }
      return r.json();
    });

    res.json(data);
  } catch (e) {
    console.error('❌ Calendar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/members', async (req, res) => {
  try {
    const data = await withAuth(async (token) => {
      const frameId = await getFrameId(token);
      const r = await fetch(`${BASE}/api/frames/${frameId}/categories`, {
        headers: skyHeaders(token),
      });
      if (r.status === 401) {
        const err = new Error('unauthorized');
        err.status = 401;
        throw err;
      }
      return r.json();
    });

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
    if (!process.env.SKYLIGHT_TOKEN) {
      console.log('🔄 No token in .env — refreshing from saved browser session...');
      await tokenManager.refresh();
    } else {
      console.log('✅ Token found in .env');
    }
    await getFrameId(tokenManager.getToken());
  } catch (e) {
    console.warn(`⚠️  ${e.message}`);
  }

  tokenManager.startAutoRefresh();
});
