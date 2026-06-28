const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
//  Group stage: all 16 eliminated teams (final)
//  Group stage ended June 27, 2026
// ─────────────────────────────────────────────
const GROUP_STAGE_ELIMINATED = [
  // 4th-place exits (one per group, 12 groups)
  'Haiti', 'Turkey', 'Tunisia', 'Jordan',
  'Qatar', 'Curaçao', 'Scotland', 'Iran',
  'Uzbekistan', 'New Zealand', 'South Korea', 'Czechia',
  'Saudi Arabia', 'Iraq', 'Uruguay', 'Panama',
];

// ─────────────────────────────────────────────
//  ESPN team name → sweepstake name
// ─────────────────────────────────────────────
const ESPN_NAME_MAP = {
  'United States':          'USA',
  'Korea Republic':         'South Korea',
  'South Korea':            'South Korea',
  "Côte d'Ivoire":          'Ivory Coast',
  "Cote d'Ivoire":          'Ivory Coast',
  'Ivory Coast':            'Ivory Coast',
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Bosnia & Herzegovina':   'Bosnia & Herz.',
  'Czech Republic':         'Czechia',
  'Cabo Verde':             'Cape Verde',
  'Türkiye':                'Turkey',
  'Turkiye':                'Turkey',
  'DR Congo':               'DR Congo',
};
const mapName = n => ESPN_NAME_MAP[n] || n;

// ─────────────────────────────────────────────
//  Cache
// ─────────────────────────────────────────────
let cache = { teams: [...GROUP_STAGE_ELIMINATED], ts: 0, source: 'group-stage', error: null };
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ─────────────────────────────────────────────
//  Fetch knockout eliminations from ESPN
//  (unofficial free API — no key required)
// ─────────────────────────────────────────────
async function fetchKnockoutEliminations() {
  const eliminated = new Set();
  const KNOCKOUT_START = new Date('2026-06-28');
  const TOURNAMENT_END = new Date('2026-07-20');
  const now = new Date();

  // Build list of dates from knockout start up to today
  const dates = [];
  for (let d = new Date(KNOCKOUT_START); d <= Math.min(now, TOURNAMENT_END); d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}${m}${day}`);
  }

  if (dates.length === 0) return eliminated; // knockout hasn't started yet

  // Fetch each date in parallel (ESPN is fast for single-day queries)
  const baseURL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
  const headers  = { 'User-Agent': 'Mozilla/5.0 (compatible; sweepstake/1.0)' };

  const results = await Promise.allSettled(
    dates.map(date =>
      fetch(`${baseURL}?dates=${date}`, { headers, signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const data = result.value;

    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      // Skip group stage matches (shouldn't appear after Jun 28 but just in case)
      const note = comp.altGameNote || '';
      if (note.toLowerCase().includes('group')) continue;

      // Only completed matches
      if (!comp.status?.type?.completed) continue;

      // Find loser (winner=false while the other has winner=true)
      const competitors = comp.competitors || [];
      const hasWinner = competitors.some(c => c.winner === true);
      if (!hasWinner) continue; // draw / AET not yet resolved — skip

      const loser = competitors.find(c => c.winner === false);
      if (loser?.team?.displayName) {
        eliminated.add(mapName(loser.team.displayName));
      }
    }
  }

  return eliminated;
}

// ─────────────────────────────────────────────
//  Main data fetch
// ─────────────────────────────────────────────
async function refreshData() {
  try {
    const knockoutOut = await fetchKnockoutEliminations();
    const all = new Set([...GROUP_STAGE_ELIMINATED, ...knockoutOut]);
    cache = {
      teams:  [...all],
      ts:     Date.now(),
      source: knockoutOut.size > 0 ? 'espn+hardcoded' : 'hardcoded',
      error:  null,
    };
    console.log(`[live] ${all.size} teams out (${knockoutOut.size} knockout, ${GROUP_STAGE_ELIMINATED.length} group stage)`);
  } catch (err) {
    console.error('[live] refresh failed:', err.message);
    cache = {
      teams:  [...GROUP_STAGE_ELIMINATED],
      ts:     Date.now(),
      source: 'hardcoded',
      error:  err.message,
    };
  }
}

// ─────────────────────────────────────────────
//  API endpoints
// ─────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ ok: true, version: '2.0.0', ts: Date.now() }));

app.get('/api/eliminated', async (req, res) => {
  const stale = Date.now() - cache.ts > CACHE_TTL;

  if (stale) {
    await refreshData();
  }

  res.json({
    teams:       cache.teams,
    lastUpdated: cache.ts,
    source:      cache.source,
    cached:      !stale,
    error:       cache.error,
  });
});

// Fallback for client-side routing
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// Warm cache on startup
refreshData().catch(console.error);

app.listen(PORT, () => {
  console.log(`⚽ Sweepstake running on port ${PORT}`);
  console.log('✅ Live knockout data: ESPN (no API key required)');
  console.log(`✅ Group stage: ${GROUP_STAGE_ELIMINATED.length} teams hardcoded`);
});
