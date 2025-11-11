// api/bus.js
// Vercel Edge Function — CTA Bus Tracker v3 → JSON
export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const stpid = searchParams.get('stpid');
    const rt = searchParams.get('rt') || '77';
    const top = searchParams.get('top') || '6';
    const key = process.env.CTA_BUS_KEY;

    if (!key) {
      return new Response(JSON.stringify({ rows: [], error: 'Missing CTA_BUS_KEY' }), { status: 500 });
    }
    if (!stpid) {
      return new Response(JSON.stringify({ rows: [], error: 'Missing stpid' }), { status: 400 });
    }

    const url =
      `https://www.ctabustracker.com/bustime/api/v3/getpredictions?format=json` +
      `&key=${key}&rt=${encodeURIComponent(rt)}&stpid=${encodeURIComponent(stpid)}&top=${encodeURIComponent(top)}`;

    const r = await fetch(url);
    const json = await r.json();

    const apiErr = json?.bustime_response?.error?.[0]?.msg ?? null;
    const rows = json?.bustime_response?.prd ?? [];

    return new Response(JSON.stringify({ rows, error: apiErr }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ rows: [], error: String(err) }), { status: 500 });
  }
}
