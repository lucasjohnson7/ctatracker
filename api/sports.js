// api/sports.js
// Vercel Edge Function — Sports for wall display
// - Bulls: NBA scoreboard + Bulls team endpoint (nextEvent)
// - Bears: NFL scoreboard + Bears team endpoint (nextEvent)
// - Creighton MBB: NCAAM scoreboard for today/live + Creighton team endpoint (nextEvent)
//
// Shape returned:
//
// {
//   live: {
//     opponentName,
//     opponentLogo,
//     usScore,
//     themScore,
//     period,
//     clock,
//     homeAway: "vs" | "@"
//   } | null,
//   next: {
//     opponentName,
//     opponentLogo,
//     date,   // "Fri, Nov 14"
//     time,   // "7:00 PM"
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

// Scoreboards (per league, "today" when no ?dates param)
const ESPN_NBA_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ESPN_NFL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

// Team endpoints (for Bulls/Bears/Creighton)
const ESPN_BULLS_TEAM =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/chi";
const ESPN_BEARS_TEAM =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/chi";
// Creighton Bluejays MBB team id is 156 on ESPN
const ESPN_CREIGHTON_TEAM =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/156";

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
    // Q1–Q4 works visually for NBA / NFL, and is “good enough” for NCAAM
    period = `Q${periodNumber}`;
  }

  const clock =
    (comp.status && comp.status.displayClock) || statusObj.displayClock || "";

  // Scores – be forgiving, and fall back to linescores if needed
  const rawUsScore   = us.score;
  const rawThemScore = them.score;

  const parsedUs   = rawUsScore != null ? parseInt(rawUsScore, 10) : NaN;
  const parsedThem = rawThemScore != null ? parseInt(rawThemScore, 10) : NaN;

  let usScore   = Number.isFinite(parsedUs)   ? parsedUs   : null;
  let themScore = Number.isFinite(parsedThem) ? parsedThem : null;

  // If totals missing, sum linescores (helps for some NCAAM finals)
  if (usScore === null && Array.isArray(us.linescores) && us.linescores.length){
    const sum = us.linescores
      .map((ls) =>
        parseInt(
          ls.value ?? ls.score ?? ls.displayValue ?? "",
          10
        )
      )
      .filter(Number.isFinite)
      .reduce((a, b) => a + b, 0);
    if (Number.isFinite(sum) && sum > 0) usScore = sum;
  }

  if (themScore === null && Array.isArray(them.linescores) && them.linescores.length){
    const sum = them.linescores
      .map((ls) =>
        parseInt(
          ls.value ?? ls.score ?? ls.displayValue ?? "",
          10
        )
      )
      .filter(Number.isFinite)
      .reduce((a, b) => a + b, 0);
    if (Number.isFinite(sum) && sum > 0) themScore = sum;
  }

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

  // FINAL
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

  // PRE-GAME
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
 * From a team JSON (ESPN team endpoint), return the "best" upcoming event
 * to treat as "next game".
 */
function getFirstNextEventFromTeam(teamJson) {
  const team = teamJson.team || {};
  const arr = team.nextEvent || [];

  if (!Array.isArray(arr) || !arr.length) return null;

  // Only accept entries that already have competitions;
  // skip $ref-only objects so we don't need another fetch.
  const fullEvent = arr.find((ev) => ev.competitions && ev.competitions.length);
  return fullEvent || null;
}

/* ===========================
   TEAM-SPECIFIC HELPERS
   =========================== */

// ---------- Bulls (NBA) ----------
async function getBullsStatus() {
  const isBulls = (c) => {
    const team = c.team || {};
    const name = team.displayName || team.name || "";
    const short = team.shortDisplayName || team.abbreviation || "";
    return name === "Chicago Bulls" || short === "CHI";
  };

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

  // 2) No game on today’s scoreboard → look at Bulls team endpoint for nextEvent
  try {
    const teamJson = await fetchJson(ESPN_BULLS_TEAM);
    const nextEvent = getFirstNextEventFromTeam(teamJson);
    if (nextEvent) {
      return mapEspnEventToLiveNext(nextEvent, isBulls);
    }
  } catch (e) {
    console.error("ESPN Bulls team endpoint error", e);
  }

  // 3) Nothing we can find
  return { live: null, next: null };
}

// ---------- Bears (NFL) ----------
async function getBearsStatus() {
  const isBears = (c) => {
    const team = c.team || {};
    const name = team.displayName || team.name || "";
    const short = team.shortDisplayName || team.abbreviation || "";
    return name === "Chicago Bears" || short === "CHI";
  };

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
  try {
    const teamJson = await fetchJson(ESPN_BEARS_TEAM);
    const nextEvent = getFirstNextEventFromTeam(teamJson);
    if (nextEvent) {
      return mapEspnEventToLiveNext(nextEvent, isBears);
    }
  } catch (e) {
    console.error("ESPN Bears team endpoint error", e);
  }

  // 3) Probably offseason
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
  const isCreighton = (c) => {
    const team = c.team || {};
    const name = team.displayName || team.name || "";
    const short = team.shortDisplayName || team.abbreviation || "";
    return name.includes("Creighton") || short === "CREI";
  };

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

  // 2) Fall back to Creighton team endpoint (id 156) for nextEvent
  try {
    const teamJson = await fetchJson(ESPN_CREIGHTON_TEAM);
    const nextEvent = getFirstNextEventFromTeam(teamJson);
    if (nextEvent) {
      return mapEspnEventToLiveNext(nextEvent, isCreighton);
    }
  } catch (e) {
    console.error("ESPN Creighton team endpoint error", e);
  }

  // 3) Offseason / no upcoming games
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
