import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAYOUT_FILE = path.join(__dirname, '..', 'data', 'layout.json');

const DEFAULTS = {
  theme: 'auto',
  autoKimballMetra: true,
  trainLoop: true,
  trainKimball: true,
  metraClybourn: false,
  metraStation: 'IRVINGPK',
  redHoward: true,
  red95th: true,
  nowPlaying: true,
  weather: true,
  sports: true,
  latestActivity: true,
  pullups: true,
  pushups: true,
  commute: true,
  autoCommute: true,
  bikeToMetra: 18,
  bikeFromMetra: 16,
  mpg: 28,
  gasPrice: 3.50,
  metraFare: 5.50,
  metraDayPass: 10.00,
  metraTicketMode: 'roundtrip',
  tollCost: 4.00,
  workWindow: 9,
  latestArrival: '09:00',
  officeClose: '16:00',
};

function readLayout() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeLayout(data) {
  fs.mkdirSync(path.dirname(LAYOUT_FILE), { recursive: true });
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(data, null, 2));
}

export function handleGet(req, res) {
  res.json(readLayout());
}

export function handlePost(req, res) {
  const update = req.body;
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }
  const merged = { ...readLayout(), ...update };
  writeLayout(merged);
  res.json(merged);
}
