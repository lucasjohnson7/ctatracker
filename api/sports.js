// Vercel Edge Function — Sports for wall board
// Uses BallDontLie for *today's* Chicago Bulls game (free tier friendly)
// and simple placeholders for Creighton + Bears.

export const config = { runtime: 'edge' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

export default async function handler(req) {
  try {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) {
      return json({ error: 'Missing BALLDONTLIE_API_KEY' }, 500);
    }

    const { searchParams } = new URL(req.url);
    const teamKey = (searchParams.get('team') || '').toLowerCase();

    // Route by team key from your front-end: creighton | bulls | bears
    if (teamKey === 'bulls') {
      const data = await getBullsStatus(apiKey);
      return json(data);
    }

    if (teamKey === 'creighton') {
      // Placeholder "next game" style entry for now
      return json({
        live: null,
        next: {
          opponentName: 'TBD',
          opponentLogo: null,
          date: 'Check Creighton schedule',
          time: ''
        }
      });
    }

    if (teamKey === 'bears') {
      // Placeholder "next game" style entry for now
      return json({
        live: null,
        next: {
          opponentName: 'TBD',
          opponentLogo: null,
          date: 'NFL schedule',
          time: ''
        }
      });
    }

    // Unknown team key
    return json({ live: null, next: null });

  } catch (err) {
    return json({ error: 'Unhandled sports error', detail: String(err) }, 500);
  }
}

/**
 * Get today's Chicago Bulls game using BallDontLie.
 *
 * Shape it into { live, next } for your front-end.
 * For now we only look at *today*, not future schedule.
 */
async function getBullsStatus(apiKey) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // 1) Get Bulls team ID (we could cache this later)
  const teamsRes = await fetch('https://api.balldontlie.io/v1/teams', {
    headers: { Authorization: apiKey }
  });

  if (!teamsRes.ok) {
    throw new Error(`Teams request failed: ${teamsRes.status}`);
  }

  const teamsJson = await teamsRes.json();
  const teams = teamsJson.data || [];

  const bullsTeam = teams.find(
    t =>
      t.full_name === 'Chicago Bulls' ||
      t.abbreviation === 'CHI'
  );

  if (!bullsTeam) {
    throw new Error('Could not find Chicago Bulls in BallDontLie teams');
  }

  // 2) Look for games today for that team
  const gamesUrl = new URL('https://api.balldontlie.io/v1/games');
  gamesUrl.searchParams.set('team_ids[]', String(bullsTeam.id));
  gamesUrl.searchParams.set('dates[]', today);
  gamesUrl.searchParams.set('per_page', '50');

  const gamesRes = await fetch(gamesUrl.toString(), {
    headers: { Authorization: apiKey }
  });

  if (!gamesRes.ok) {
    throw new Error(`Games request failed: ${gamesRes.status}`);
  }

  const gamesJson = await gamesRes.json();
  const games = gamesJson.data || [];

  if (!games.length) {
    // No game today
    return {
      live: null,
      next: null
    };
  }

  const game = games[0]; // assume first is fine for one team in one day

  const home = game.home_team;
  const away = game.visitor_team || game.away_team;
  const isHome = home && home.id === bullsTeam.id;

  const opponent = isHome ? away : home;
  const opponentName = opponent ? opponent.full_name : 'Opponent';

  const homeScore = game.home_team_score ?? null;
  const awayScore = game.visitor_team_score ?? null;

  const hasScores =
    typeof homeScore === 'number' &&
    typeof awayScore === 'number' &&
    (!Number.isNaN(homeScore) || !Number.isNaN(awayScore));

  const status = (game.status || '').toLowerCase();

  // Very rough classification:
  const isFinal = status.includes('final');
  const isInGame =
    status.includes('1st') ||
    status.includes('2nd') ||
    status.includes('3rd') ||
    status.includes('4th') ||
    status.includes('qtr') ||
    status.includes('quarter') ||
    status.includes('half');

  // If we have scores and it's live or finished, treat as "live" for your UI
  if (hasScores && (isFinal || isInGame)) {
    const bullsScore = isHome ? homeScore : awayScore;
    const oppScore = isHome ? awayScore : homeScore;

    return {
      live: {
        opponentName,
        opponentLogo: null, // you’re already showing the Bulls logo from the front-end
        usScore: bullsScore,
        themScore: oppScore,
        period: isFinal ? 'F' : game.status || '',
        clock: '',          // BallDontLie basic games endpoint doesn’t always give clock
        homeAway: isHome ? 'vs' : '@'
      },
      next: null
    };
  }

  // Otherwise: treat it as an upcoming game "later today"
  const d = new Date(game.date);
  const dateText = d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
  const timeText = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit'
  });

  return {
    live: null,
    next: {
      opponentName,
      opponentLogo: null,
      date: dateText,
      time: timeText
    }
  };
}
