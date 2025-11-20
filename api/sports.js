// api/sports.js
// Vercel Edge Function — Sports for wall display
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

const ESPN_NBA_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ESPN_NFL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

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
   COMMON HELPERS
   =========================== */

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
 * Try to pull a numeric score from an ESPN competitor object.
 * Handles:
 *   - competitor.score
 *   - competitor.linescores[*].value / score / displayValue
 *   - competitor.statistics entries named "points", "pts", or "score"
 */
function extractScore(competitor) {
  if (!competitor) return null;

  // 1) direct "score" field
  if (
    competitor.score !== undefined &&
    competitor.score !== null &&
    String(competitor.score).trim() !== ""
  ) {
    const n = parseInt(competitor.score, 10);
    if (Number.isFinite(n)) return n;
  }

  // 2) sum of linescores
  const lines = competitor.linescores || competitor.lineScores || [];
  if (Array.isArray(lines) && lines.length) {
    let total = 0;
    let found = false;
    for (const ls of lines) {
      const v =
        ls?.value ??
        ls?.score ??
        ls?.displayValue ??
        ls?.points ??
        (Array.isArray(ls?.statistics)
          ? ls.statistics[0]?.value
          : undefined);

      const n = parseInt(v, 10);
      if (Number.isFinite(n)) {
        total += n;
        found = true;
      }
    }
    if (found) return total;
  }

  // 3) statistics array (sometimes has "points" or "pts")
  const stats = competitor.statistics || competitor.stats || [];
  if (Array.isArray(stats)) {
    for (const s of stats) {
      const label = (
        s?.name ||
        s?.label ||
        s?.abbreviation ||
        ""
      ).toLowerCase();
      if (
        label.includes("point") ||
        label === "pts" ||
        label === "score"
      ) {
        const v = s.value ?? s.displayValue;
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) return n;
      }
    }
  }

  return null;
}

/**
 * Normalize an ESPN event -> { live, next } from our team's POV.
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
    (comp.status && typeof comp.status.period === "number"
      ? comp.status.period
      : statusObj.period) ?? null;

  let period = "";
  if (typeof periodNumber === "number" && periodNumber > 0) {
    period = `Q${periodNumber}`;
  }

  const clock =
    (comp.status && comp.status.displayClock) || statusObj.displayClock || "";

  const usScore = extractScore(us);
  const themScore = extractScore(them);

  const { dateText, timeText } = formatCentralDateTime(event.date);

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

function getFirstNextEventFromTeam(teamJson) {
  const team = teamJson.team || {};
  const arr = team.nextEvent || [];
  if (!Array.isArray(arr) || !arr.length) return null;

  return (
    arr.find((ev) => ev.competitions && ev.competitions.length) || null
  );
}

/* ===========================
   TEAM-SPECIFIC HELPERS
   =========================== */

// ---------- Bulls ----------
async function getBullsStatus() {
  const isBulls = (c) => {
    const team = c.team || {};
    const name = team.displayName || team.name || "";
    const short = team.shortDisplayName || team.abbreviation || "";
    return name === "Chicago Bulls" || short === "CHI";
  };

  try {
    const sb = await fetchJson(ESPN_NBA_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some(isBulls);
    });

    if (event) return mapEspnEventToLiveNext(event, isBulls);
  } catch (e) {
    console.error("ESPN Bulls scoreboard error", e);
  }

  try {
    const teamJson = await fetchJson(ESPN_BULLS_TEAM);
    const nextEvent = getFirstNextEventFromTeam(teamJson);
    if (nextEvent) return mapEspnEventToLiveNext(nextEvent, isBulls);
  } catch (e) {
    console.error("ESPN Bulls team endpoint error", e);
  }

  return { live: null, next: null };
}

// ---------- Bears ----------
async function getBearsStatus() {
  const isBears = (c) => {
    const team = c.team || {};
    const name = team.displayName || team.name || "";
    const short = team.shortDisplayName || team.abbreviation || "";
    return name === "Chicago Bears" || short === "CHI";
  };

  try {
    const sb = await fetchJson(ESPN_NFL_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some(isBears);
    });

    if (event) return mapEspnEventToLiveNext(event, isBears);
  } catch (e) {
    console.error("ESPN Bears scoreboard error", e);
  }

  try {
    const teamJson = await fetchJson(ESPN_BEARS_TEAM);
    const nextEvent = getFirstNextEventFromTeam(teamJson);
    if (nextEvent) return mapEspnEventToLiveNext(nextEvent, isBears);
  } catch (e) {
    console.error("ESPN Bears team endpoint error", e);
  }

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

// ---------- Creighton ----------
async function getCreightonStatus() {
  const isCreighton = (c) => {
    const team = c.team || {};
    const name = team.displayName || team.name || "";
    const short = team.shortDisplayName || team.abbreviation || "";
    return name.includes("Creighton") || short === "CREI";
  };

  try {
    const sb = await fetchJson(ESPN_NCAAM_SCOREBOARD);
    const events = sb.events || [];

    const event = events.find((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return false;
      return comp.competitors.some(isCreighton);
    });

    if (event) return mapEspnEventToLiveNext(event, isCreighton);
  } catch (e) {
    console.error("ESPN Creighton scoreboard error", e);
  }

  try {
    const teamJson = await fetchJson(ESPN_CREIGHTON_TEAM);
    const nextEvent = getFirstNextEventFromTeam(teamJson);
    if (nextEvent) return mapEspnEventToLiveNext(nextEvent, isCreighton);
  } catch (e) {
    console.error("ESPN Creighton team endpoint error", e);
  }

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
      return json(await getBullsStatus());
    }
    if (teamKey === "bears") {
      return json(await getBearsStatus());
    }
    if (teamKey === "creighton") {
      return json(await getCreightonStatus());
    }

    return json({ live: null, next: null });
  } catch (err) {
    console.error("sports error", err);
    return json(
      { error: "Unhandled sports error", detail: String(err) },
      500
    );
  }
}
