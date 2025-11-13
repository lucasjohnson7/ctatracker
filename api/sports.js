// api/sports.js
// Vercel Edge Function — Sports for wall display
// Uses BallDontLie (NBA) ONLY for the Chicago Bulls.
// Creighton + Bears return static "check schedule" messages.

export const config = { runtime: 'edge' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const teamKey = (searchParams.get('team') || '').toLowerCase();

    if (teamKey === 'bulls') {
      const data = await getBullsStatus();
      return json(data);
    }

    if (teamKey === 'creighton') {
      // Static “check schedule” line for Jays
      return json({
        live: null,
        next: {
          opponentName: 'TBD',
          opponentLogo: null,
          date: 'Check Creighton schedule',
          time: '',
        },
      });
    }

    if (teamKey === 'bears') {
      // Static “check schedule” line for Bears
      return json({
        live: null,
        next: {
          opponentName: 'TBD',
          opponentLogo: null,
          date: 'Check Bears/NFL schedule',
          time: '',
        },
      });
    }

    // Unknown team key
    return json({ live: null, next: null });
  } catch (err) {
    console.error('sports error', err);
    return json({ error: 'Unhandled sports error', detail: String(err) }, 500);
  }
}

/* ===== Bulls helper using BallDontLie (NBA-only) ===== */

async function getBullsStatus() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing BALLDONTLIE_API_KEY');
  }

  // 1) Get Bulls team id from /v1/teams
  const teamsRes = await fetch('https://api.balldontlie.io/v1/teams', {
    headers: { Authorization: apiKey },
    cache: 'no-store',
  });

  if (!teamsRes.ok) {
    throw new Error(`Teams request failed: ${teamsRes.status}`);
  }

  const teamsJson = await teamsRes.json();
  const teams = teamsJson.data || [];

  const bulls = teams.find(
    (t) => t.full_name === 'Chicago Bulls' || t.abbreviation === 'CHI'
  );

  if (!bulls) {
    throw new Error('Could not find Chicago Bulls team');
  }

  // 2) Look for games from today forward ~60 days
  const today = new Date();
  const startStr = today.toISOString().slice(0, 10);

  const end = new Date(today);
  end.setDate(end.getDate() + 60);
  const endStr = end.toISOString().slice(0, 10);

  const gamesUrl = new URL('https://api.balldontlie.io/v1/games');
  gamesUrl.searchParams.set('team_ids[]', String(bulls.id));
  gamesUrl.searchParams.set('start_date', startStr);
  gamesUrl.searchParams.set('end_date', endStr);
  gamesUrl.searchParams.set('per_page', '82');

  const gamesRes = await fetch(gamesUrl.toString(), {
    headers: { Authorization: apiKey },
    cache: 'no-store',
  });

  if (!gamesRes.ok) {
    throw new Error(`Games request failed: ${gamesRes.status}`);
  }

  const gamesJson = await gamesRes.json();
  const games = gamesJson.data || [];
  if (!games.length) {
    // No upcoming games in the window
    return { live: null, next: null };
  }

  // Sort by date, pick earliest upcoming
  const sorted = games
    .map((g) => ({ g, d: new Date(g.date) }))
    .filter((x) => !Number.isNaN(x.d.getTime()))
    .sort((a, b) => a.d - b.d);

  const game = sorted[0].g;

  const home = game.home_team;
  const away = game.visitor_team;
  const isHome = home && home.id === bulls.id;
  const opp = isHome ? away : home;

  const opponentName = opp ? opp.full_name : 'Opponent';

  const d = new Date(game.date);
  const dateText = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeText = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const homeScore = game.home_team_score;
  const awayScore = game.visitor_team_score;

  const hasScores =
    typeof homeScore === 'number' &&
    typeof awayScore === 'number' &&
    (!Number.isNaN(homeScore) || !Number.isNaN(awayScore));

  const statusRaw = game.status || '';
  const status = statusRaw.toLowerCase();

  const isFinal = status.includes('final');
  const isInGame =
    status.includes('qtr') ||
    status.includes('quarter') ||
    status.includes('half');

  // If there are scores and it’s in-progress or final, treat as live
  if (hasScores && (isFinal || isInGame)) {
    const bullsScore = isHome ? homeScore : awayScore;
    const oppScore = isHome ? awayScore : homeScore;

    return {
      live: {
        opponentName,
        opponentLogo: null,
        usScore: bullsScore,
        themScore: oppScore,
        period: isFinal ? 'F' : statusRaw || '',
        clock: '',
        homeAway: isHome ? 'vs' : '@',
      },
      next: null,
    };
  }

  // Otherwise, it's an upcoming game
  return {
    live: null,
    next: {
      opponentName,
      opponentLogo: null,
      date: dateText,
      time: timeText,
    },
  };
}
