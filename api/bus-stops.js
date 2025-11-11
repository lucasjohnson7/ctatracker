// api/bus-stops.js
export const config = { runtime: 'edge' };

export default async function handler(req){
  try {
    const { searchParams } = new URL(req.url);
    const rt = searchParams.get('rt') || '77';
    const dir = searchParams.get('dir'); // e.g. "Eastbound" or "Westbound"
    const key = process.env.CTA_BUS_KEY;
    if (!key) return new Response(JSON.stringify({ stops: [], error: 'Missing CTA_BUS_KEY' }), { status: 500 });

    const base = `https://www.ctabustracker.com/bustime/api/v3/getstops?format=json&key=${encodeURIComponent(key)}&rt=${encodeURIComponent(rt)}`;
    const url = dir ? `${base}&dir=${encodeURIComponent(dir)}` : base;

    const r = await fetch(url, { headers: { 'User-Agent': 'ctatracker/1.0 (+vercel)' } });
    const json = await r.json();
    const stops = json?.bustime-response?.stops ?? [];
    const apiErr = json?.bustime-response?.error?.[0]?.msg ?? null;

    return new Response(JSON.stringify({ stops, error: apiErr }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (e) {
    return new Response(JSON.stringify({ stops: [], error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
