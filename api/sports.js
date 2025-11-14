// api/sports.js
// Vercel Edge Function — Sports for wall display
// - Bulls: ESPN NBA scoreboard (live/Final/pregame) + static schedule fallback
// - Bears: ESPN NFL scoreboard + static schedule fallback
// - Creighton MBB: ESPN NCAAM scoreboard + static schedule fallback

export const config = { runtime: "edge" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/* ===========================
   ESPN SCOREBOARD HELPERS
   =========================== */

const ESPN_NBA_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ESPN_NFL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

// >>> Central time zone for ALL formatting <<<
const TIME_ZONE = "America/Chicago";

async function fetchEspnScoreboard(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ESPN scoreboard error ${res.status}`);
  }
  return res.json();
}

/**
 * Map a single ESPN event to your { live, next } shape.
 *
 * @param {object} event  - ESPN scoreboard event
 * @param {function} isOurTeam - (competitor) => boolean
 */
function mapEspnEventToLiveNext(event, isOurTeam) {
  if (!event || !event.competitions || !event.competitions.length) {
    return { live: null, next: null };
  }

  const comp = event.competitions[0];
  const competitors = comp.competitors || [];

  const us = competitors.find(isOurTeam);
  if (!us) return { live: null, next: null };

  const them = competitors.find((c) => c !== us);
  if (!them) return { live: null, next: null };

  const isHome = us.homeAway === "home";

  const statusObj =
    (comp.status && comp.status.type) ||
    (event.status && event.status.type) ||
    {};
  const rawState = (statusObj.state || "").toLowerCase(); // "pre" | "in" | "post"

  const periodNumber =
    comp.status && typeof comp.status.period === "number"
      ? comp.status.period
      : statusObj.period;
  const period =
    periodNumber != null && periodNumber !== 0 ? `Q${periodNumber}` : "";

  const clock =
    (comp.status && comp.status.displayClock) || statusObj.displayClock || "";

  const usScore = parseInt(us.score, 10);
  const themScore = parseInt(them.score, 10);

  // ESPN `event.date` is UTC; we format it explicitly in Central time.
  const dateObj = new Date(event.date);

  const dateText = dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TIME_ZONE,
  });

  const timeText = dateObj.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });

  const teamInfo = them.team || {};
  const opponentName =
    teamInfo.displayName || teamInfo.name || "Opponent";

  const opponentLogo =
    Array.isArray(teamInfo.logos) && teamInfo.logos.length
      ? teamInfo.logos[0].href
      : teamInfo.logo || null;

  // LIVE
  if (rawState === "in") {
    return {
      live: {
        opponentName,
        opponentLogo,
        usScore: Number.isFinite(usScore) ? usScore : null,
        themScore: Number.isFinite(themScore) ? themScore : null,
        period: period || statusObj.shortDetail || "",
        clock,
        homeAway: isHome ? "vs" : "@",
      },
      next: null,
    };
  }

  // FINAL
  if (rawState === "post") {
    return {
      live: {
        opponentName,
        opponentLogo,
        usScore: Number.isFinite(usScore) ? usScore : null,
        themScore: Number.isFinite(themScore) ? themScore : null,
        period: "F",
        clock: "",
        homeAway: isHome ? "vs" : "@",
      },
      next: null,
    };
  }

  // PRE-GAME (upcoming on the scoreboard date)
  return {
    live: null,
    next: {
      opponentName,
      opponentLogo,
      date: dateText,
      time: timeText,
      homeAway: isHome ? "vs" : "@",
    },
  };
}

/* ===========================
   STATIC SCHEDULE HELPERS
   =========================== */

function findNextFromSchedule(schedule) {
  const now = new Date();

  const enriched = schedule
    .map((g) => ({ ...g, dateObj: new Date(g.date) }))
    .filter((g) => !Number.isNaN(g.dateObj.getTime()));

  const upcoming = enriched
    .filter((g) => g.dateObj >= now)
    .sort((a, b) => a.dateObj - b.dateObj);

  const next = upcoming[0];
  if (!next) return null;

  const dateStr = next.dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TIME_ZONE,
  });

  const timeStr = next.dateObj.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });

  return {
    opponentName: next.opponentName,
    opponentLogo: next.opponentLogo || null,
    date: dateStr,
    time: timeStr,
    homeAway: next.homeAway || "vs",
  };
}

/* ===========================
   SCHEDULE DATA (all with -06:00)
   =========================== */

// Small Bulls schedule for fallback when ESPN has no game today.
const BULLS_SCHEDULE = [
  {
    date: "2025-11-16T17:00:00-06:00",
    opponentName: "Utah Jazz",
    homeAway: "@",
    opponentLogo: "https://a.espncdn.com/i/teamlogos/nba/500/uta.png",
  },
  {
    date: "2025-11-17T18:00:00-06:00",
    opponentName: "Denver Nuggets",
    homeAway: "@",
    opponentLogo: "https://a.espncdn.com/i/teamlogos/nba/500/den.png",
  },
  {
    date: "2025-11-19T19:00:00-06:00",
    opponentName: "Portland Trail Blazers",
    homeAway: "@",
    opponentLogo: "https://a.espncdn.com/i/teamlogos/nba/500/por.png",
  },
  {
    date: "2025-11-21T19:00:00-06:00",
    opponentName: "Miami Heat",
    homeAway: "vs",
    opponentLogo: "https://a.espncdn.com/i/teamlogos/nba/500/mia.png",
  },
  {
    date: "2025-11-22T19:00:00-06:00",
    opponentName: "Miami Heat",
    homeAway: "vs",
    opponentLogo: "https://a.espncdn.com/i/teamlogos/nba/500/mia.png",
  },
];

// All times CENTRAL — Bears 2025
const BEARS_SCHEDULE = [
  {
    date: "2025-09-08T19:15:00-06:00",
    opponentName: "Minnesota Vikings",
    homeAway: "vs",
  },
  {
    date: "2025-09-14T12:00:00-06:00",
    opponentName: "Detroit Lions",
    homeAway: "@",
  },
  {
    date: "2025-09-21T15:25:00-06:00",
    opponentName: "Dallas Cowboys",
    homeAway: "vs",
  },
  {
    date: "2025-09-28T15:25:00-06:00",
    opponentName: "Las Vegas Raiders",
    homeAway: "@",
  },
  {
    date: "2025-10-13T19:15:00-06:00",
    opponentName: "Washington Commanders",
    homeAway: "@",
  },
  {
    date: "2025-10-19T12:00:00-06:00",
    opponentName: "New Orleans Saints",
    homeAway: "vs",
  },
  {
    date: "2025-10-26T12:00:00-06:00",
    opponentName: "Baltimore Ravens",
    homeAway: "@",
  },
  {
    date: "2025-11-02T12:00:00-06:00",
    opponentName: "Cincinnati Bengals",
    homeAway: "@",
  },
  {
    date: "2025-11-09T12:00:00-06:00",
    opponentName: "New York Giants",
    homeAway: "vs",
  },
  {
    date: "2025-11-16T12:00:00-06:00",
    opponentName: "Minnesota Vikings",
    homeAway: "@",
  },
  {
    date: "2025-11-23T12:00:00-06:00",
    opponentName: "Pittsburgh Steelers",
    homeAway: "vs",
  },
  {
    date: "2025-11-28T14:00:00-06:00",
    opponentName: "Philadelphia Eagles",
    homeAway: "@",
  },
  {
    date: "2025-12-07T12:00:00-06:00",
    opponentName: "Green Bay Packers",
    homeAway: "@",
  },
  {
    date: "2025-12-14T12:00:00-06:00",
    opponentName: "Cleveland Browns",
    homeAway: "vs",
  },
  {
    date: "2025-12-20T12:00:00-06:00",
    opponentName: "Green Bay Packers",
    homeAway: "vs",
  },
  {
    date: "2025-12-28T19:20:00-06:00",
    opponentName: "San Francisco 49ers",
    homeAway: "@",
  },
  {
    date: "2026-01-03T12:00:00-06:00",
    opponentName: "Detroit Lions",
    homeAway: "vs",
  },
];

// Partial Creighton 2025–26 MBB schedule (Central, explicit offset)
const CREIGHTON_SCHEDULE = [
  {
    date: "2025-11-05T20:00:00-06:00",
    opponentName: "South Dakota",
    homeAway: "vs",
  },
  {
    date: "2025-11-11T22:00:00-06:00",
    opponentName: "Gonzaga",
    homeAway: "@",
  },
  {
    date: "2025-11-14T19:00:00-06:00", // 7:00 PM CT vs MES
    opponentName: "Maryland Eastern Shore",
    homeAway: "vs",
  },
  {
    date: "2025-11-19T20:00:00-06:00",
    opponentName: "North Dakota",
    homeAway: "vs",
  },
  {
    date: "2025-11-24T14:00:00-06:00",
    opponentName: "Baylor",
    homeAway: "vs", // neutral in Vegas
  },
  {
    date: "2025-11-25T14:00:00-06:00",
    opponentName: "Iowa State",
    homeAway: "vs", // neutral
  },
  {
    date: "2025-12-02T21:00:00-06:00",
    opponentName: "Nicholls",
    homeAway: "vs",
  },
  {
    date: "2025-12-07T17:00:00-06:00",
    opponentName: "Nebraska",
    homeAway: "@",
  },
];

/* ===========================
   TEAM-SPECIFIC FUNCTIONS
   =========================== */

// Bulls: ESPN NBA scoreboard, then fallback to BULLS_SCHEDULE
async function getBullsStatus() {
  try {
    const sb = await fetchEspnScoreboard(ESPN_NBA_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some((c) => {
        const team = c.team || {};
        const name = team.displayName || team.name || "";
        const short =
          team.shortDisplayName || team.abbreviation || "";
        return name === "Chicago Bulls" || short === "CHI";
      });
    });

    if (event) {
      return mapEspnEventToLiveNext(event, (c) => {
        const team = c.team || {};
        const name = team.displayName || team.name || "";
        const short =
          team.shortDisplayName || team.abbreviation || "";
        return name === "Chicago Bulls" || short === "CHI";
      });
    }
  } catch (e) {
    console.error("espn bulls error", e);
  }

  const next = findNextFromSchedule(BULLS_SCHEDULE);
  if (!next) return { live: null, next: null };
  return { live: null, next };
}

// Bears: ESPN NFL scoreboard, then BEARS_SCHEDULE fallback
async function getBearsStatus() {
  try {
    const sb = await fetchEspnScoreboard(ESPN_NFL_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some((c) => {
        const team = c.team || {};
        const name = team.displayName || team.name || "";
        const short =
          team.shortDisplayName || team.abbreviation || "";
        return name === "Chicago Bears" || short === "CHI";
      });
    });

    if (event) {
      return mapEspnEventToLiveNext(event, (c) => {
        const team = c.team || {};
        const name = team.displayName || team.name || "";
        const short =
          team.shortDisplayName || team.abbreviation || "";
        return name === "Chicago Bears" || short === "CHI";
      });
    }
  } catch (e) {
    console.error("espn bears error", e);
  }

  const next = findNextFromSchedule(BEARS_SCHEDULE);
  if (!next) {
    return {
      live: null,
      next: {
        opponentName: "Season complete",
        opponentLogo: null,
        date: "",
        time: "",
        homeAway: "vs",
      },
    };
  }
  return { live: null, next };
}

// Creighton: ESPN NCAAM scoreboard, then CREIGHTON_SCHEDULE fallback
async function getCreightonStatus() {
  try {
    const sb = await fetchEspnScoreboard(ESPN_NCAAM_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some((c) => {
        const team = c.team || {};
        const name = team.displayName || team.name || "";
        const short =
          team.shortDisplayName || team.abbreviation || "";
        return name.includes("Creighton") || short === "CREI";
      });
    });

    if (event) {
      return mapEspnEventToLiveNext(event, (c) => {
        const team = c.team || {};
        const name = team.displayName || team.name || "";
        const short =
          team.shortDisplayName || team.abbreviation || "";
        return name.includes("Creighton") || short === "CREI";
      });
    }
  } catch (e) {
    console.error("espn creighton error", e);
  }

  const next = findNextFromSchedule(CREIGHTON_SCHEDULE);
  if (!next) {
    return {
      live: null,
      next: {
        opponentName: "Season complete",
        opponentLogo: null,
        date: "",
        time: "",
        homeAway: "vs",
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
    const teamKey = (searchParams.get("team") || "").toLowerCase();

    if (teamKey === "bulls") {
      const data = await getBullsStatus();
      return json(data);
    }

    if (teamKey === "bears") {
      const data = await getBearsStatus();
      return json(data);
    }

    if (teamKey === "creighton") {
      const data = await getCreightonStatus();
      return json(data);
    }

    // Unknown team key
    return json({ live: null, next: null });
  } catch (err) {
    console.error("sports error", err);
    return json(
      { error: "Unhandled sports error", detail: String(err) },
      500
    );
  }
}
