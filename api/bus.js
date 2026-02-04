// api/bus.js
export const config = { runtime: "edge" };

export default async function handler(req) {
  try {
    // ✅ Works on Vercel (absolute URL) AND locally (relative URL)
    const urlObj =
      req.nextUrl ||
      new URL(req.url, `http://${req.headers?.host || "localhost"}`);

    const stpid = urlObj.searchParams.get("stpid");
    const rt = urlObj.searchParams.get("rt") || "77";
    const top = urlObj.searchParams.get("top") || "6";
    const key = process.env.CTA_BUS_KEY;

    if (!key) {
      return new Response(JSON.stringify({ rows: [], error: "Missing CTA_BUS_KEY" }), {
        status: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    if (!stpid) {
      return new Response(JSON.stringify({ rows: [], error: "Missing stpid" }), {
        status: 400,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    const apiUrl =
      `https://www.ctabustracker.com/bustime/api/v3/getpredictions?format=json` +
      `&key=${encodeURIComponent(key)}` +
      `&rt=${encodeURIComponent(rt)}` +
      `&stpid=${encodeURIComponent(stpid)}` +
      `&top=${encodeURIComponent(top)}`;

    const r = await fetch(apiUrl, {
      headers: { "User-Agent": "ctatracker/1.0 (local)" },
      cache: "no-store",
    });

    const json = await r.json();

    // CTA uses "bustime-response" (hyphen)
    const root = json?.["bustime-response"] ?? json?.bustime_response ?? {};
    const apiErr = root?.error?.[0]?.msg ?? null;
    const rows = root?.prd ?? [];

    return new Response(JSON.stringify({ rows, error: apiErr }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ rows: [], error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
