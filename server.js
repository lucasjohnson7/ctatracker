// server.js (ESM, Vercel Edge–compatible)
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { handleGet as pullupGet, handleInc as pullupInc, handleDec as pullupDec } from "./api/pullups.js";

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.post("/api/pullups/:person/inc", pullupInc);
app.post("/api/pullups/:person/dec", pullupDec);

// ----------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
