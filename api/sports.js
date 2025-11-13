// api/sports.js
// Edge function that returns game status for Bulls / Bears / Creighton
// Uses BALLDONTLIE for NBA + NFL
export const config = { runtime: 'edge' };

const API_BASE = 'https://api.balldontlie.io';
const API_KEY  = process.env.BALLDONTLIE_API_KEY; // you already created this

async function balldontlieFetch(path, params = {}) {
  if (!API_KEY) {
    throw new Error('Missing BALLDONTLIE_API_KEY env var');
  }

  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach(v => url.searchParams.append(key, v));
    } else {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: API_KEY },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BALDONTLIE error ${res.status}: ${text}`);
  }
  return res.json();
}

/* ---------- Helpers for JSON shape your front-end expects ---------- */

function makeEmptyResponse(message = 'No game info.') {
  return {
    live: null,
    next: {
      opponentName: 'TBD',
      opponentLogo: null,
      date: message,
      time: '',
    },
  };
}

/* ---------- BULLS (NBA) ---------- */
// This assumes you already had something like this; leaving simple here.
// If you already have a working Bulls implementation, you can keep that
// and delete this whole function + the bulls case in handler.
async function getBullsStatus() {
  // Find Bulls team id (NBA)
  const teams = await balldontlieFetch('/nba/v1/teams');
  const bulls = (teams.data || []).find(
    t => t.full_name === 'Chicago Bulls' || t.abbreviation === 'CHI'
  );
  if (!bulls) return makeEmptyResponse('NBA schedule');

  const today = new Date();
  const season = today.getFullYear(); // close enough for your wall display

  // Get all Bulls games this season
  const gamesResp = await balldontlieFetch('/nba/v1/games', {
    seasons: [season],
    'team_ids[]': [bulls.id],
    per_page: 100,
  });
  const games = gamesResp.data || [];

  return pickLiveAndNextGame(games, bulls.id, 'NBA schedule');
}

/* ---------- BEARS (NFL) ---------- */

async function getBearsStatus() {
  // 1) Get all NFL teams and find the Bears
  const teams = await balldontlieFetch('/nfl/v1/teams');
  const bears = (teams.data || []).find(
    t => t.full_name === 'Chicago Bears' ||
         (t.location === 'Chicago' && t.name === 'Bears')
  );
  if (!bears) return makeEmptyResponse('NFL schedule');

  const now = new Date();
  const season = now.getFullYear();

  // 2) Get all Bears games this season
  const gamesResp = await balldontlieFetch('/nfl/v1/games', {
    seasons: [season],
    'team_ids[]': [bears.id],
    per_page: 100,
  });
  const games = gamesResp.data || [];

  return pickLiveAndNextGame(games, bears.id, 'NFL schedule');
}

/* ---------- Shared: pick live + next from a list of games ---------- */

function pickLiveAndNextGame(games, ourTeamId, fallbackLabel) {
  if (!games.length) return makeEmptyResponse(fallbackLabel);

  const now = new Date();
  let live = null;
  let next = null;

  for (const g of games) {
    const date = new Date(g.date);
    const isHome = g.home_team && g.home_team.id === ourTeamId;
    const home = g.home_team;
    const away = g.visitor_team || g.away_team; // different sports name this differently
    if (!home || !away) continue;

    const usScore   = isHome ? g.home_team_score   : g.visitor_team_score;
    const themScore = isHome ? g.visitor_team_score : g.home_team_score;
    const opponent  = isHome ? away : home;

    // Treat non-final past/ongoing games as "live"
    if (date <= now && g.status && g.status !== 'Final') {
      live = {
        opponentName: opponent.full_name || opponent.name,
        opponentLogo: null, // you can wire in team logos later if you want
        usScore: typeof usScore === 'number' ? usScore : null,
        themScore: typeof themScore === 'number' ? themScore : null,
        period: g.status,    // e.g. "Q4", "Halftime", etc.
        clock: '',           // NFL games endpoint doesn't expose clock
        homeAway: isHome ? 'vs' : '@',
      };
    }

    // Future game: candidate for "next"
    if (date > now) {
      if (!next || date < next._dateObj) {
        next = {
          opponentName: opponent.full_name || opponent.name,
          opponentLogo: null,
          date: date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
          time: date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          }),
          homeAway: isHome ? 'vs' : '@',
          _dateObj: date,
        };
      }
    }
  }

  if (next) {
    // fold home/away into the text via your front-end (it prefixes "vs" already),
    // so we just leave opponentName/date/time here.
    delete next._dateObj;
  }

  if (!live && !next) {
    return makeEmptyResponse(fallbackLabel);
  }

  return { live, next };
}

/* ---------- CREIGHTON (NCAAB) ---------- */

async function getCreightonStatus() {
  // On the free NCAAB tier, the Games/Odds endpoints are locked, so we can't
  // legally pull live scores or schedule from BALLDONTLIE.
  // We just return a friendly static message.
  return makeEmptyResponse('Check Creighton schedule');
}

/* ---------- Main handler ---------- */

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const team = (searchParams.get('team') || '').toLowerCase();

    let payload;
    if (team === 'bulls') {
      payload = await getBullsStatus();
    } else if (team === 'bears') {
      payload = await getBearsStatus();
    } else if (team === 'creighton') {
      payload = await getCreightonStatus();
    } else {
      payload = makeEmptyResponse('Unknown team');
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    console.error('sports handler error', err);
    return new Response(
      JSON.stringify({ error: 'sports handler error', detail: String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
