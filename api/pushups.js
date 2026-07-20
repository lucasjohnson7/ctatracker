import db from "../db.js";

const CENTRAL_TZ = "America/Chicago";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function getCount(date, person) {
  const row = db.prepare("SELECT count FROM pushup_counts WHERE date = ? AND person = ?").get(date, person);
  return row ? row.count : 0;
}

function upsertCount(date, person, delta) {
  const current = getCount(date, person);
  const next = Math.max(0, current + delta);
  db.prepare(
    "INSERT INTO pushup_counts (date, person, count) VALUES (?, ?, ?) ON CONFLICT(date, person) DO UPDATE SET count = ?"
  ).run(date, person, next, next);
  return next;
}

export function handleGet(req, res) {
  const date = today();
  res.json({
    date,
    colin: getCount(date, "colin"),
    lucas: getCount(date, "lucas"),
  });
}

export function handleInc(req, res) {
  const person = req.params.person?.toLowerCase();
  if (person !== "colin" && person !== "lucas") {
    return res.status(400).json({ error: "Invalid person" });
  }
  const date = today();
  const count = upsertCount(date, person, 1);
  res.json({ person, count, date });
}

export function handleDec(req, res) {
  const person = req.params.person?.toLowerCase();
  if (person !== "colin" && person !== "lucas") {
    return res.status(400).json({ error: "Invalid person" });
  }
  const date = today();
  const count = upsertCount(date, person, -1);
  res.json({ person, count, date });
}

function dailyRecord(person) {
  const row = db.prepare("SELECT MAX(count) as best FROM pushup_counts WHERE person = ?").get(person);
  return row ? row.best || 0 : 0;
}

function weekTotal(person) {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  const since = d.toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
  const row = db.prepare("SELECT COALESCE(SUM(count),0) as total FROM pushup_counts WHERE person = ? AND date >= ?").get(person, since);
  return row.total;
}

function monthTotal(person) {
  const prefix = today().slice(0, 7); // YYYY-MM
  const row = db.prepare("SELECT COALESCE(SUM(count),0) as total FROM pushup_counts WHERE person = ? AND date LIKE ?").get(person, prefix + "%");
  return row.total;
}

function streak(person) {
  const rows = db.prepare("SELECT date, count FROM pushup_counts WHERE person = ? ORDER BY date DESC").all(person);
  if (!rows.length) return 0;

  const todayStr = today();
  let count = 0;
  const d = new Date(todayStr + "T12:00:00");

  for (let i = 0; i < 1000; i++) {
    const check = d.toISOString().slice(0, 10);
    const found = rows.find(r => r.date === check);
    if (found && found.count > 0) {
      count++;
    } else if (i === 0) {
      // today hasn't had any yet — check from yesterday
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function allTime(person) {
  const row = db.prepare("SELECT COALESCE(SUM(count),0) as total FROM pushup_counts WHERE person = ?").get(person);
  return row.total;
}

export function handleStats(req, res) {
  res.json({
    dailyRecord: { colin: dailyRecord("colin"), lucas: dailyRecord("lucas") },
    weekTotal:   { colin: weekTotal("colin"),   lucas: weekTotal("lucas") },
    monthTotal:  { colin: monthTotal("colin"),  lucas: monthTotal("lucas") },
    streak:      { colin: streak("colin"),      lucas: streak("lucas") },
    allTime:     { colin: allTime("colin"),     lucas: allTime("lucas") },
  });
}
