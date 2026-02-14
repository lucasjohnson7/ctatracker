import db from "../db.js";

const CENTRAL_TZ = "America/Chicago";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function getCount(date, person) {
  const row = db.prepare("SELECT count FROM pullup_counts WHERE date = ? AND person = ?").get(date, person);
  return row ? row.count : 0;
}

function upsertCount(date, person, delta) {
  const current = getCount(date, person);
  const next = Math.max(0, current + delta);
  db.prepare(
    "INSERT INTO pullup_counts (date, person, count) VALUES (?, ?, ?) ON CONFLICT(date, person) DO UPDATE SET count = ?"
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
