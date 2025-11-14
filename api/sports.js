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

// ===== Simple "next game" helper for static schedules =====

// Each game: { date: ISO string, opponentName: string, homeAway: 'vs' | '@' }
function findNextFromSchedule(schedule) {
  const now = new Date();

  const enriched = schedule
    .map(g => ({ ...g, dateObj: new Date(g.date) }))
    .filter(g => !Number.isNaN(g.dateObj.getTime()));

  // All future (or "today but later") games
  const upcoming = enriched
    .filter(g => g.dateObj >= now)
    .sort((a, b) => a.dateObj - b.dateObj);

  const next = upcoming[0];
  if (!next) return null;

  const dateStr = next.dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  const timeStr = next.dateObj.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  return {
    opponentName: next.opponentName,
    opponentLogo: next.opponentLogo || null,
    date: dateStr,
    time: timeStr,
    homeAway: next.homeAway || "vs"
  };
}

// ======== FILL THESE OUT ONCE PER SEASON ========

// Example Chicago Bears games (REPLACE with real schedule)
// All times: Central, from Bears 2025 schedule
const BEARS_SCHEDULE = [
  // Week 1 – Mon, Sep 8 vs Vikings – 7:15 PM
  {
    date: "2025-09-08T19:15:00",
    opponentName: "Minnesota Vikings",
    homeAway: "vs"
  },

  // Week 2 – Sun, Sep 14 @ Lions – Noon
  {
    date: "2025-09-14T12:00:00",
    opponentName: "Detroit Lions",
    homeAway: "@"
  },

  // Week 3 – Sun, Sep 21 vs Cowboys – 3:25 PM
  {
    date: "2025-09-21T15:25:00",
    opponentName: "Dallas Cowboys",
    homeAway: "vs"
  },

  // Week 4 – Sun, Sep 28 @ Raiders – 3:25 PM
  {
    date: "2025-09-28T15:25:00",
    opponentName: "Las Vegas Raiders",
    homeAway: "@"
  },

  // Week 5 – BYE (no entry needed)

  // Week 6 – Mon, Oct 13 @ Washington – 7:15 PM
  {
    date: "2025-10-13T19:15:00",
    opponentName: "Washington Commanders",
    homeAway: "@"
  },

  // Week 7 – Sun, Oct 19 vs Saints – Noon
  {
    date: "2025-10-19T12:00:00",
    opponentName: "New Orleans Saints",
    homeAway: "vs"
  },

  // Week 8 – Sun, Oct 26 @ Ravens – Noon
  {
    date: "2025-10-26T12:00:00",
    opponentName: "Baltimore Ravens",
    homeAway: "@"
  },

  // Week 9 – Sun, Nov 2 @ Bengals – Noon
  {
    date: "2025-11-02T12:00:00",
    opponentName: "Cincinnati Bengals",
    homeAway: "@"
  },

  // Week 10 – Sun, Nov 9 vs Giants – Noon
  {
    date: "2025-11-09T12:00:00",
    opponentName: "New York Giants",
    homeAway: "vs"
  },

  // Week 11 – Sun, Nov 16 @ Vikings – Noon
  {
    date: "2025-11-16T12:00:00",
    opponentName: "Minnesota Vikings",
    homeAway: "@"
  },

  // Week 12 – Sun, Nov 23 vs Steelers – Noon
  {
    date: "2025-11-23T12:00:00",
    opponentName: "Pittsburgh Steelers",
    homeAway: "vs"
  },

  // Week 13 – Fri, Nov 28 @ Eagles – 2:00 PM
  {
    date: "2025-11-28T14:00:00",
    opponentName: "Philadelphia Eagles",
    homeAway: "@"
  },

  // Week 14 – Sun, Dec 7 @ Packers – Noon
  {
    date: "2025-12-07T12:00:00",
    opponentName: "Green Bay Packers",
    homeAway: "@"
  },

  // Week 15 – Sun, Dec 14 vs Browns – Noon
  {
    date: "2025-12-14T12:00:00",
    opponentName: "Cleveland Browns",
    homeAway: "vs"
  },

  // Week 16 – Sat, Dec 20 vs Packers – time TBD → using 12:00 PM placeholder
  {
    date: "2025-12-20T12:00:00",
    opponentName: "Green Bay Packers",
    homeAway: "vs"
  },

  // Week 17 – Sun, Dec 28 @ 49ers – 7:20 PM
  {
    date: "2025-12-28T19:20:00",
    opponentName: "San Francisco 49ers",
    homeAway: "@"
  },

  // Week 18 – Sat/Sun Jan 3/4 vs Lions – time/date TBD
  // I’ll pick Jan 3 at 12:00 PM as a placeholder; you can tweak later.
  {
    date: "2026-01-03T12:00:00",
    opponentName: "Detroit Lions",
    homeAway: "vs"
  }
];

// Example Creighton MBB games (REPLACE with real schedule)
const CREIGHTON_SCHEDULE = [
  // Example from GoCreighton: vs Maryland Eastern Shore — Fri Nov 14 7:00 PM
  {
    date: "2025-11-14T19:00:00-06:00",
    opponentName: "Maryland Eastern Shore",
    homeAway: "vs"
  },
  // add more games here...
];

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const teamKey = (searchParams.get('team') || '').toLowerCase();

    if (teamKey === 'bulls') {
      const data = await getBullsStatus();
      return json(data);
    }

if (teamKey === 'creighton') {
  const next = findNextFromSchedule(CREIGHTON_SCHEDULE);

  if (!next) {
    return json({
      live: null,
      next: {
        opponentName: 'Season complete',
        opponentLogo: null,
        date: '',
        time: '',
        homeAway: 'vs'
      }
    });
  }

  return json({
    live: null,
    next
  });
}


if (teamKey === 'bears') {
  const next = findNextFromSchedule(BEARS_SCHEDULE);

  if (!next) {
    // Season over or schedule empty
    return json({
      live: null,
      next: {
        opponentName: 'Season complete',
        opponentLogo: null,
        date: '',
        time: '',
        homeAway: 'vs'
      }
    });
  }

  return json({
    live: null,  // we're not doing live NFL scoring (yet)
    next
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
