// api/train.js
export const config = { runtime: "edge" };

export default async function handler(req) {
  try {
    // IMPORTANT: Express gives relative req.url, Edge gives absolute.
    // This makes it work in both places.
    const base = `http://${req.headers.get?.("host") || req.headers.host || "localhost"}`;
    const { searchParams } = new URL(req.url, base);

    const mapid = searchParams.get("mapid");
    const max = searchParams.get("max") || "10";
    const key = process.env.CTA_TRAIN_KEY;

    if (!key) {
      return new Response(JSON.stringify({ error: "Missing CTA_TRAIN_KEY" }), { status: 500 });
    }
    if (!mapid) {
      return new Response(JSON.stringify({ error: "Missing mapid" }), { status: 400 });
    }

    // CTA Train Tracker Arrivals API
    const url =
      `https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?outputType=JSON` +
      `&key=${encodeURIComponent(key)}` +
      `&mapid=${encodeURIComponent(mapid)}` +
      `&max=${encodeURIComponent(max)}`;

    const r = await fetch(url, {
      headers: { "User-Agent": "ctatracker/1.0 (local)" },
      cache: "no-store",
    });

    const json = await r.json();

    // Typical shape: { ctatt: { eta: [...], errCd, errNm } }
    const root = json?.ctatt ?? {};
    const apiErr =
      root?.errNm ||
      (root?.errCd && root?.errCd !== "0" ? `CTA error code ${root.errCd}` : null);

    const rows = Array.isArray(root?.eta) ? root.eta : [];

    // Return rows directly so your frontend can do: data.filter(...)
    return new Response(JSON.stringify(rows), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      status: apiErr ? 502 : 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
