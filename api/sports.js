// api/sports.js
// Vercel Edge Function — Sports for wall display
// - Bulls: ESPN NBA scoreboard + Bulls team endpoint
// - Bears: ESPN NFL scoreboard + Bears team endpoint
// - Creighton MBB: ESPN NCAAM scoreboard + Creighton team endpoint
//
// Shape returned to the browser:
//
// {
//   live: {
//     opponentName: string,
//     opponentLogo: string | null,
//     usScore: number | null,
//     themScore: number | null,
//     period: string,     // "Q3", "F", "H1", etc
//     clock: string,      // "7:45"
//     homeAway: "vs" | "@"
//   } | null,
//   next: {
//     opponentName: string,
//     opponentLogo: string | null,
//     date: string,       // "Fri, Nov 14"
//     time: string,       // "7:00 PM"
//     homeAway: "vs" | "@"
//   } | null
// }

export const config = { runtime: "edge" };

const CENTRAL_TZ = "America/Chicago";

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
   ESPN ENDPOINTS
   =========================== */

// Scoreboards (per league, "today")
const ESPN_NBA_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ESPN_NFL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

// Team endpoints (for nextEvent / upcoming games)
const ESPN_BULLS_TEAM =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/chi";
const ESPN_BEARS_TEAM =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/chi";
const ESPN_CREIGHTON_TEAM =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/creighton-bluejays";

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ESPN error ${res.status} for ${url}`);
  }
  return res.json();
}

/* ===========================
   COMMON MAPPERS
   =========================== */

/**
 * Format date/time in Central Time from an ESPN event date.
 */
function formatCentralDateTime(dateIsoString) {
  const d = new Date(dateIsoString);

  const dateText = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: CENTRAL_TZ,
  });

  const timeText = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CENTRAL_TZ,
  });

  return { dateText, timeText };
}

/**
 * Given an ESPN event and a predicate that tells us which competitor is "us",
 * return { live, next } in your normalized shape.
 *
 * @param {object} event - ESPN event (from scoreboard or team.nextEvent)
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

  // Status info
  const statusObj =
    (comp.status && comp.status.type) ||
    (event.status && event.status.type) ||
    {};
  const rawState = (statusObj.state || "").toLowerCase(); // "pre" | "in" | "post"

  // Period + clock
  const periodNumber =
    comp.status && typeof comp.status.period === "number"
      ? comp.status.period
      : statusObj.period;

  let period = "";
  if (typeof periodNumber === "number" && periodNumber > 0) {
    // Good for NBA/NFL; looks fine for NCAAM too
    period = `Q${periodNumber}`;
  }

  const clock =
    (comp.status && comp.status.displayClock) || statusObj.displayClock || "";

  // Scores
  const usScore = Number.isFinite(parseInt(us.score, 10))
    ? parseInt(us.score, 10)
    : null;
  const themScore = Number.isFinite(parseInt(them.score, 10))
    ? parseInt(them.score, 10)
    : null;

  // Date/time (Central)
  const { dateText, timeText } = formatCentralDateTime(event.date);

  // Opponent info (logo from ESPN)
  const teamInfo = them.team || {};
  const opponentName =
    teamInfo.displayName ||
    teamInfo.shortDisplayName ||
    teamInfo.name ||
    "Opponent";

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
        usScore,
        themScore,
        period: period || statusObj.shortDetail || "",
        clock,
        homeAway: isHome ? "vs" : "@",
      },
      next: null,
    };
  }

  // FINAL (postgame) — still nice to see the final score
  if (rawState === "post") {
    return {
      live: {
        opponentName,
        opponentLogo,
        usScore,
        themScore,
        period: "F",
        clock: "",
        homeAway: isHome ? "vs" : "@",
      },
      next: null,
    };
  }

  // PRE-GAME (upcoming game on that date)
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

/**
 * Generic helper:
 * - fetch team endpoint
 * - look at team.nextEvent
 * - if it contains a full event, use that
 * - if it only has a $ref, follow it and fetch the real event
 * - return { live, next } or null if nothing
 */
async function getNextFromTeamEndpoint(teamUrl, isOurTeam) {
  try {
    const teamJson = await fetchJson(teamUrl);
    const team = teamJson.team || {};
    const arr = team.nextEvent || [];

    if (!Array.isArray(arr) || !arr.length) return null;

    // 1) Prefer entries that already have competitions
    let event =
      arr.find((ev) => ev.competitions && ev.competitions.length) || null;

    // 2) Otherwise, follow a $ref link to fetch the real event
    if (!event) {
      const first = arr[0] || {};
      let ref = first.$ref;

      // Sometimes they put links in a "links" array instead
      if (!ref && Array.isArray(first.links)) {
        const evtLink = first.links.find(
          (lnk) =>
            Array.isArray(lnk.rel) && lnk.rel.some((r) => r.includes("event"))
        );
        if (evtLink && evtLink.href) {
          ref = evtLink.href;
        }
      }

      if (ref) {
        event = await fetchJson(ref);
      }
    }

    if (!event) return null;

    return mapEspnEventToLiveNext(event, isOurTeam);
  } catch (e) {
    console.error("ESPN team endpoint error", teamUrl, e);
    return null;
  }
}

/* ===========================
   TEAM-SPECIFIC HELPERS
   =========================== */

const isBulls = (c) => {
  const team = c.team || {};
  const name = team.displayName || team.name || "";
  const short = team.shortDisplayName || team.abbreviation || "";
  return name === "Chicago Bulls" || short === "CHI";
};

const isBears = (c) => {
  const team = c.team || {};
  const name = team.displayName || team.name || "";
  const short = team.shortDisplayName || team.abbreviation || "";
  return name === "Chicago Bears" || short === "CHI";
};

const isCreighton = (c) => {
  const team = c.team || {};
  const name = team.displayName || team.name || "";
  const short = team.shortDisplayName || team.abbreviation || "";
  return name.includes("Creighton") || short === "CREI";
};

// ---------- Bulls (NBA) ----------
async function getBullsStatus() {
  // 1) Today’s game (or live) from NBA scoreboard
  try {
    const sb = await fetchJson(ESPN_NBA_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some(isBulls);
    });

    if (event) {
      return mapEspnEventToLiveNext(event, isBulls);
    }
  } catch (e) {
    console.error("ESPN Bulls scoreboard error", e);
  }

  // 2) No game on today’s scoreboard → look at Bulls team endpoint
  const nextFromTeam = await getNextFromTeamEndpoint(
    ESPN_BULLS_TEAM,
    isBulls
  );
  if (nextFromTeam) return nextFromTeam;

  // 3) Nothing we can find
  return { live: null, next: null };
}

// ---------- Bears (NFL) ----------
async function getBearsStatus() {
  // 1) Today’s game / live from NFL scoreboard
  try {
    const sb = await fetchJson(ESPN_NFL_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some(isBears);
    });

    if (event) {
      return mapEspnEventToLiveNext(event, isBears);
    }
  } catch (e) {
    console.error("ESPN Bears scoreboard error", e);
  }

  // 2) Fall back to Bears team endpoint for nextEvent
  const nextFromTeam = await getNextFromTeamEndpoint(
    ESPN_BEARS_TEAM,
    isBears
  );
  if (nextFromTeam) return nextFromTeam;

  // 3) Truly offseason
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

// ---------- Creighton (NCAAM) ----------
async function getCreightonStatus() {
  // 1) Today’s (or live) game from NCAAM scoreboard
  try {
    const sb = await fetchJson(ESPN_NCAAM_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some(isCreighton);
    });

    if (event) {
      return mapEspnEventToLiveNext(event, isCreighton);
    }
  } catch (e) {
    console.error("ESPN Creighton scoreboard error", e);
  }

  // 2) Fall back to Creighton team endpoint for nextEvent
  const nextFromTeam = await getNextFromTeamEndpoint(
    ESPN_CREIGHTON_TEAM,
    isCreighton
  );
  if (nextFromTeam) return nextFromTeam;

  // 3) Offseason
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
