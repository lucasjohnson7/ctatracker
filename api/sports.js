// api/sports.js
// Vercel Edge Function — Sports for wall display
// - Bulls: ESPN NBA scoreboard (live / final / pregame)
// - Bears: static schedule (with optional ESPN NFL live override later if you want)
// - Creighton MBB: static schedule (with optional ESPN NCAAM live override later)

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

/* ===========================
   ESPN SCOREBOARD HELPERS
   =========================== */

const ESPN_NBA_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const ESPN_NFL_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const ESPN_NCAAM_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

// generic fetcher
async function fetchEspnScoreboard(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`ESPN scoreboard error ${res.status}`);
  }
  return res.json();
}

/**
 * Map a single ESPN event to your { live, next } shape.
 *
 * isOurTeam: function(competitor) → true if that competitor is "us"
 */
function mapEspnEventToLiveNext(event, isOurTeam) {
  if (!event || !event.competitions || !event.competitions.length) {
    return { live: null, next: null };
  }

  const comp = event.competitions[0];
  const competitors = comp.competitors || [];

  const us = competitors.find(isOurTeam);
  if (!us) return { live: null, next: null };

  const them = competitors.find(c => c !== us);
  if (!them) return { live: null, next: null };

  const isHome = us.homeAway === 'home';

  const statusObj =
    (comp.status && comp.status.type) ||
    (event.status && event.status.type) ||
    {};
  const rawState = (statusObj.state || '').toLowerCase(); // "pre", "in", "post"
  const periodNumber =
    comp.status && typeof comp.status.period === 'number'
      ? comp.status.period
      : statusObj.period;
  const period =
    periodNumber != null && periodNumber !== 0 ? `Q${periodNumber}` : '';
  const clock =
    (comp.status && comp.status.displayClock) || statusObj.displayClock || '';

  const usScore = parseInt(us.score, 10);
  const themScore = parseInt(them.score, 10);

  const dateObj = new Date(event.date);
  const dateText = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeText = dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const opponentName =
    (them.team && them.team.displayName) ||
    (them.team && them.team.name) ||
    'Opponent';
  const opponentLogo =
    them.team && Array.isArray(them.team.logos) && them.team.logos.length
      ? them.team.logos[0].href
      : them.team && them.team.logo
      ? them.team.logo
      : null;

  // LIVE
  if (rawState === 'in') {
    return {
      live: {
        opponentName,
        opponentLogo,
        usScore: Number.isFinite(usScore) ? usScore : null,
        themScore: Number.isFinite(themScore) ? themScore : null,
        period: period || statusObj.shortDetail || '',
        clock,
        homeAway: isHome ? 'vs' : '@',
      },
      next: null,
    };
  }

  // FINAL
  if (rawState === 'post') {
    return {
      live: {
        opponentName,
        opponentLogo,
        usScore: Number.isFinite(usScore) ? usScore : null,
        themScore: Number.isFinite(themScore) ? themScore : null,
        period: 'F',
        clock: '',
        homeAway: isHome ? 'vs' : '@',
      },
      next: null,
    };
  }

  // PRE-GAME (upcoming)
  return {
    live: null,
    next: {
      opponentName,
      opponentLogo,
      date: dateText,
      time: timeText,
      homeAway: isHome ? 'vs' : '@',
    },
  };
}

/* ===========================
   STATIC SCHEDULE HELPERS
   =========================== */

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

  const dateStr = next.dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const timeStr = next.dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return {
    opponentName: next.opponentName,
    opponentLogo: next.opponentLogo || null,
    date: dateStr,
    time: timeStr,
    homeAway: next.homeAway || 'vs',
  };
}

/* ===========================
   SCHEDULE DATA
   =========================== */

// All times: Central, from Bears 2025 schedule
const BEARS_SCHEDULE = [
  // Week 1 – Mon, Sep 8 vs Vikings – 7:15 PM
  {
    date: '2025-09-08T19:15:00',
    opponentName: 'Minnesota Vikings',
    homeAway: 'vs',
  },

  // Week 2 – Sun, Sep 14 @ Lions – Noon
  {
    date: '2025-09-14T12:00:00',
    opponentName: 'Detroit Lions',
    homeAway: '@',
  },

  // Week 3 – Sun, Sep 21 vs Cowboys – 3:25 PM
  {
    date: '2025-09-21T15:25:00',
    opponentName: 'Dallas Cowboys',
    homeAway: 'vs',
  },

  // Week 4 – Sun, Sep 28 @ Raiders – 3:25 PM
  {
    date: '2025-09-28T15:25:00',
    opponentName: 'Las Vegas Raiders',
    homeAway: '@',
  },

  // Week 6 – Mon, Oct 13 @ Washington – 7:15 PM
  {
    date: '2025-10-13T19:15:00',
    opponentName: 'Washington Commanders',
    homeAway: '@',
  },

  // Week 7 – Sun, Oct 19 vs Saints – Noon
  {
    date: '2025-10-19T12:00:00',
    opponentName: 'New Orleans Saints',
    homeAway: 'vs',
  },

  // Week 8 – Sun, Oct 26 @ Ravens – Noon
  {
    date: '2025-10-26T12:00:00',
    opponentName: 'Baltimore Ravens',
    homeAway: '@',
  },

  // Week 9 – Sun, Nov 2 @ Bengals – Noon
  {
    date: '2025-11-02T12:00:00',
    opponentName: 'Cincinnati Bengals',
    homeAway: '@',
  },

  // Week 10 – Sun, Nov 9 vs Giants – Noon
  {
    date: '2025-11-09T12:00:00',
    opponentName: 'New York Giants',
    homeAway: 'vs',
  },

  // Week 11 – Sun, Nov 16 @ Vikings – Noon
  {
    date: '2025-11-16T12:00:00',
    opponentName: 'Minnesota Vikings',
    homeAway: '@',
  },

  // Week 12 – Sun, Nov 23 vs Steelers – Noon
  {
    date: '2025-11-23T12:00:00',
    opponentName: 'Pittsburgh Steelers',
    homeAway: 'vs',
  },

  // Week 13 – Fri, Nov 28 @ Eagles – 2:00 PM
  {
    date: '2025-11-28T14:00:00',
    opponentName: 'Philadelphia Eagles',
    homeAway: '@',
  },

  // Week 14 – Sun, Dec 7 @ Packers – Noon
  {
    date: '2025-12-07T12:00:00',
    opponentName: 'Green Bay Packers',
    homeAway: '@',
  },

  // Week 15 – Sun, Dec 14 vs Browns – Noon
  {
    date: '2025-12-14T12:00:00',
    opponentName: 'Cleveland Browns',
    homeAway: 'vs',
  },

  // Week 16 – Sat, Dec 20 vs Packers – time TBD → using 12:00 PM placeholder
  {
    date: '2025-12-20T12:00:00',
    opponentName: 'Green Bay Packers',
    homeAway: 'vs',
  },

  // Week 17 – Sun, Dec 28 @ 49ers – 7:20 PM
  {
    date: '2025-12-28T19:20:00',
    opponentName: 'San Francisco 49ers',
    homeAway: '@',
  },

  // Week 18 – placeholder vs Lions
  {
    date: '2026-01-03T12:00:00',
    opponentName: 'Detroit Lions',
    homeAway: 'vs',
  },
];

// Minimal Creighton schedule for now; you can paste full schedule later
const CREIGHTON_SCHEDULE = [
  {
    date: '2025-11-14T19:00:00-06:00',
    opponentName: 'Maryland Eastern Shore',
    homeAway: 'vs',
  },
  // add more games here...
];

/* ===========================
   TEAM-SPECIFIC FUNCTIONS
   =========================== */

// Bulls from ESPN NBA scoreboard
async function getBullsFromEspn() {
  const sb = await fetchEspnScoreboard(ESPN_NBA_SCOREBOARD);
  const events = sb.events || [];

  const event = events.find(ev => {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp || !comp.competitors) return false;
    return comp.competitors.some(c => {
      const team = c.team || {};
      const name = team.displayName || team.name || '';
      const short = team.shortDisplayName || team.abbreviation || '';
      return (
        name === 'Chicago Bulls' ||
        short === 'CHI'
      );
    });
  });

  if (!event) {
    // No Bulls game on today's scoreboard – treat as no game today
    return { live: null, next: null };
  }

  return mapEspnEventToLiveNext(event, c => {
    const team = c.team || {};
    const name = team.displayName || team.name || '';
    const short = team.shortDisplayName || team.abbreviation || '';
    return name === 'Chicago Bulls' || short === 'CHI';
  });
}

// Bears: for now, just use static schedule.
// If you want to add ESPN NFL live later, we can layer it in.
async function getBearsStatus() {
  const next = findNextFromSchedule(BEARS_SCHEDULE);
  if (!next) {
    return {
      live: null,
      next: {
        opponentName: 'Season complete',
        opponentLogo: null,
        date: '',
        time: '',
        homeAway: 'vs',
      },
    };
  }
  return { live: null, next };
}

// Creighton: static schedule for now.
// Later we can add ESPN NCAAM scoreboard and fall back to this.
async function getCreightonStatus() {
  const next = findNextFromSchedule(CREIGHTON_SCHEDULE);
  if (!next) {
    return {
      live: null,
      next: {
        opponentName: 'Season complete',
        opponentLogo: null,
        date: '',
        time: '',
        homeAway: 'vs',
      },
    };
  }
  return { live: null, next };
}

/* ===========================
   MAIN HANDLER
   =========================== */

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const teamKey = (searchParams.get('team') || '').toLowerCase();

    if (teamKey === 'bulls') {
      const data = await getBullsFromEspn();
      return json(data);
    }

    if (teamKey === 'bears') {
      const data = await getBearsStatus();
      return json(data);
    }

    if (teamKey === 'creighton') {
      const data = await getCreightonStatus();
      return json(data);
    }

    // Unknown team key
    return json({ live: null, next: null });
  } catch (err) {
    console.error('sports error', err);
    return json({ error: 'Unhandled sports error', detail: String(err) }, 500);
  }
}
