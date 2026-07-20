// server.js (ESM, Vercel Edge–compatible)
import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { handleGet as pullupGet, handleInc as pullupInc, handleDec as pullupDec, handleStats as pullupStats } from "./api/pullups.js";
import { handleGet as pushupGet, handleInc as pushupInc, handleDec as pushupDec, handleStats as pushupStats } from "./api/pushups.js";
import { handleGet as layoutGet, handlePost as layoutPost } from "./api/layout.js";
import { handleGet as presenceGet, handlePost as presencePost } from "./api/presence.js";
import { handleGet as analyticsGet } from "./api/analytics.js";

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Serve static files (index.html, css, images, slideshow)
app.use(express.static(__dirname, { extensions: ["html"] }));

async function callHandler(filePath, req, res) {
  try {
    // Dynamically import the Vercel-style module
    const mod = await import(pathToFileURL(filePath).href);
    const handler = mod.default;

    if (typeof handler !== "function") {
      return res.status(500).json({
        error: "Handler is not a function",
        file: path.basename(filePath),
        exports: Object.keys(mod),
      });
    }

    // ---- Vercel Edge compatibility shim ----
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host || `localhost:${PORT}`;
    const absoluteUrl = `${proto}://${host}${req.originalUrl || req.url}`;

    // Provide req.nextUrl like Next.js / Vercel Edge
    req.nextUrl = new URL(absoluteUrl);

    // Some Edge handlers expect headers.get()
    if (!req.headers.get) {
      req.headers.get = (name) => req.headers[name.toLowerCase()];
    }
    // ---------------------------------------

    const result = await handler(req, res);

    // ---- Handle Edge-style `return new Response()` ----
    if (
      result &&
      typeof result === "object" &&
      typeof result.status === "number" &&
      typeof result.headers?.get === "function"
    ) {
      res.status(result.status);
      result.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const buffer = Buffer.from(await result.arrayBuffer());
      return res.send(buffer);
    }

    return result;
  } catch (err) {
    console.error("API handler error:", filePath);
    console.error(err);
    return res.status(500).json({
      error: "API handler crashed",
      file: path.basename(filePath),
    });
  }
}

// ---------------- ROUTES ----------------

app.get("/api/ping", (req, res) =>
  callHandler(path.join(__dirname, "api", "ping.js"), req, res)
);

app.get("/api/train", (req, res) =>
  callHandler(path.join(__dirname, "api", "train.js"), req, res)
);

app.get("/api/bus", (req, res) =>
  callHandler(path.join(__dirname, "api", "bus.js"), req, res)
);

app.get("/api/bus-stops", (req, res) =>
  callHandler(path.join(__dirname, "api", "bus-stops.js"), req, res)
);

app.get("/api/bus-dirs", (req, res) =>
  callHandler(path.join(__dirname, "api", "bus-dirs.js"), req, res)
);

app.get("/api/bus-raw", (req, res) =>
  callHandler(path.join(__dirname, "api", "bus-raw.js"), req, res)
);

app.get("/api/sports", (req, res) =>
  callHandler(path.join(__dirname, "api", "sports.js"), req, res)
);

// Sonos
app.get("/api/sonos/login", (req, res) =>
  callHandler(path.join(__dirname, "api", "sonos", "login.js"), req, res)
);

app.get("/api/sonos/callback", (req, res) =>
  callHandler(path.join(__dirname, "api", "sonos", "callback.js"), req, res)
);

app.get("/api/sonos/now-playing", (req, res) =>
  callHandler(path.join(__dirname, "api", "sonos", "now-playing.js"), req, res)
);

// Pull-ups
app.get("/api/pullups", pullupGet);
app.get("/api/pullups/stats", pullupStats);
app.post("/api/pullups/:person/inc", pullupInc);
app.post("/api/pullups/:person/dec", pullupDec);

// Analytics
app.get("/api/analytics", analyticsGet);

// Layout
app.get("/api/layout", layoutGet);
app.post("/api/layout", layoutPost);

// Presence
app.get("/api/presence", presenceGet);
app.post("/api/presence", presencePost);

// Push-ups
app.get("/api/pushups", pushupGet);
app.get("/api/pushups/stats", pushupStats);
app.post("/api/pushups/:person/inc", pushupInc);
app.post("/api/pushups/:person/dec", pushupDec);

// Poller ingest — the poller runs on the home server (better connection,
// less load on the Pi) and mirrors each output here, so the frontend keeps
// reading static files under ./data. .json bodies replace the file
// atomically; .jsonl bodies append one line (the commute logs).
const DATA_DIR = path.join(__dirname, "data");
const INGEST_NAME_RE = /^[a-zA-Z0-9_-]+\.(json|jsonl)$/;
app.post("/api/ingest/:name", (req, res) => {
  const expected = process.env.INGEST_TOKEN;
  const provided = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { name } = req.params;
  if (!INGEST_NAME_RE.test(name)) {
    return res.status(400).json({ error: "bad filename" });
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const filePath = path.join(DATA_DIR, name);
    if (name.endsWith(".jsonl")) {
      fs.appendFileSync(filePath, JSON.stringify(req.body) + "\n");
    } else {
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(req.body));
      fs.renameSync(tmp, filePath);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("ingest error:", name, err);
    res.status(500).json({ error: "write failed" });
  }
});

// ----------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
