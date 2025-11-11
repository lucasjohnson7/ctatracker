export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const rt = searchParams.get('rt') || '77';
    const key = process.env.CTA_BUS_KEY;
    if (!key) {
      return new Response(JSON.stringify({ directions: [], error: 'Missing CTA_BUS_KEY' }), { status: 500 });
    }

    const url = `https://www.ctabustracker.com/bustime/api/v3/getdirections?format=json&key=${encodeURIComponent(
      key
    )}&rt=${encodeURIComponent(rt)}`;

    const r = await fetch(url, { headers: { 'User-Agent': 'ctatracker/1.0 (+vercel)' } });
    const text = await r.text();

    if (!r.ok) {
      return new Response(JSON.stringify({ directions: [], error: `Upstream ${r.status}: ${text.slice(0,200)}` }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    let json;
    try { json = JSON.parse(text); }
    catch (e) {
      return new Response(JSON.stringify({ directions: [], error: `Non-JSON from CTA: ${text.slice(0,200)}` }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const apiErr = json?.bustime_response?.error?.[0]?.msg ?? null;
    const directions = json?.bustime_response?.directions ?? [];
    return new Response(JSON.stringify({ directions, error: apiErr }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ directions: [], error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
