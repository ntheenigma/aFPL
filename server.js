const express = require('express');
const compression = require('compression');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Gzip everything
app.use(compression());

// Static files with aggressive caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}));

// --- In-memory cache for FPL API ---
const cache = new Map();
const CACHE_TTL = {
  bootstrap: 5 * 60 * 1000,   // 5 min — player/team data changes rarely
  live: 60 * 1000,             // 1 min — live scores during matches
  entry: 2 * 60 * 1000,        // 2 min — user teams
  fixtures: 5 * 60 * 1000,     // 5 min
  leagues: 2 * 60 * 1000,      // 2 min
  default: 2 * 60 * 1000,
};

function getCacheTTL(urlPath) {
  if (urlPath.includes('bootstrap-static')) return CACHE_TTL.bootstrap;
  if (urlPath.includes('/live/')) return CACHE_TTL.live;
  if (urlPath.includes('/entry/')) return CACHE_TTL.entry;
  if (urlPath.includes('fixtures')) return CACHE_TTL.fixtures;
  if (urlPath.includes('leagues-classic')) return CACHE_TTL.leagues;
  return CACHE_TTL.default;
}

function fetchFPL(urlPath) {
  return new Promise((resolve, reject) => {
    const cached = cache.get(urlPath);
    if (cached && Date.now() - cached.time < getCacheTTL(urlPath)) {
      return resolve(cached.data);
    }

    const options = {
      hostname: 'fantasy.premierleague.com',
      path: `/api${urlPath}`,
      method: 'GET',
      headers: {
        'User-Agent': 'aFPL/1.0',
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          cache.set(urlPath, { data, time: Date.now() });
          resolve(data);
        } catch (e) {
          reject(new Error(`Failed to parse FPL response for ${urlPath}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('FPL API timeout'));
    });
    req.end();
  });
}

// --- API Routes (proxy to FPL with caching) ---

// Bootstrap — all players, teams, gameweeks
app.get('/api/bootstrap-static/', async (req, res) => {
  try {
    const data = await fetchFPL('/bootstrap-static/');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch FPL data' });
  }
});

// Fixtures
app.get('/api/fixtures/', async (req, res) => {
  try {
    const data = await fetchFPL('/fixtures/');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch fixtures' });
  }
});

// Live gameweek data
app.get('/api/event/:gw/live/', async (req, res) => {
  try {
    const data = await fetchFPL(`/event/${req.params.gw}/live/`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch live data' });
  }
});

// User entry (team info)
app.get('/api/entry/:id/', async (req, res) => {
  try {
    const data = await fetchFPL(`/entry/${req.params.id}/`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch entry' });
  }
});

// User's gameweek picks
app.get('/api/entry/:id/event/:gw/picks/', async (req, res) => {
  try {
    const data = await fetchFPL(`/entry/${req.params.id}/event/${req.params.gw}/picks/`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch picks' });
  }
});

// User's transfer history
app.get('/api/entry/:id/transfers/', async (req, res) => {
  try {
    const data = await fetchFPL(`/entry/${req.params.id}/transfers/`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch transfers' });
  }
});

// User's history (season + past seasons)
app.get('/api/entry/:id/history/', async (req, res) => {
  try {
    const data = await fetchFPL(`/entry/${req.params.id}/history/`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch history' });
  }
});

// Classic league standings
app.get('/api/leagues-classic/:id/standings/', async (req, res) => {
  try {
    const page = req.query.page_standings || 1;
    const data = await fetchFPL(`/leagues-classic/${req.params.id}/standings/?page_standings=${page}`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch league standings' });
  }
});

// Player detailed stats
app.get('/api/element-summary/:id/', async (req, res) => {
  try {
    const data = await fetchFPL(`/element-summary/${req.params.id}/`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch player summary' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`aFPL running on http://localhost:${PORT}`);
});
