import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRESENCE_FILE = path.join(__dirname, '..', 'data', 'presence.json');

function readPresence() {
  try {
    const data = JSON.parse(fs.readFileSync(PRESENCE_FILE, 'utf8'));
    // Auto-expire after 24 hours
    const age = Date.now() - new Date(data.updatedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) return { home: false, updatedAt: null };
    return data;
  } catch {
    return { home: false, updatedAt: null };
  }
}

function writePresence(data) {
  fs.mkdirSync(path.dirname(PRESENCE_FILE), { recursive: true });
  fs.writeFileSync(PRESENCE_FILE, JSON.stringify(data, null, 2));
}

export function handleGet(req, res) {
  res.json(readPresence());
}

export function handlePost(req, res) {
  const { home } = req.body || {};
  if (typeof home !== 'boolean') {
    return res.status(400).json({ error: 'body must include { "home": true|false }' });
  }
  const data = { home, updatedAt: new Date().toISOString() };
  writePresence(data);
  console.log(`[presence] home=${home} at ${data.updatedAt}`);
  res.json(data);
}
