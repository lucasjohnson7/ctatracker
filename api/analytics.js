import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

export function handleGet(req, res) {
  // Pull-ups & push-ups from SQLite
  let pullups = [], pushups = [];
  try {
    const db = new Database(path.join(DATA_DIR, 'pullups.db'), { readonly: true });
    pullups = db.prepare('SELECT date, person, count FROM pullup_counts ORDER BY date, person').all();
    pushups = db.prepare('SELECT date, person, count FROM pushup_counts ORDER BY date, person').all();
    db.close();
  } catch (e) {
    console.error('analytics db error:', e);
  }

  // Commute log from JSONL
  let commute = [];
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'commute_log.jsonl'), 'utf8');
    commute = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    // file may not exist yet
  }

  // Return commute log from JSONL
  let commuteReturn = [];
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'commute_return_log.jsonl'), 'utf8');
    commuteReturn = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    // file may not exist yet
  }

  // Layout settings (for biking legs)
  let layout = {};
  try {
    layout = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'layout.json'), 'utf8'));
  } catch (e) {}

  res.json({ pullups, pushups, commute, commuteReturn, layout });
}
