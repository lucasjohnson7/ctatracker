// api/bus-raw.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const stpid = searchParams.get('stpid');
    const rt = searchParams.get('rt') || '77';
    const top = searchParams.get('top') || '6';
    const key = process.env.CTA_BUS_KEY;
    if (!key) return new Response('Missing CTA_BUS_KEY', { status: 500 });

    const url =
      `https://www.ctabustracker.com/bustime/api/v3/getpredictions?format=json` +
      `&key=${encodeURIComponent(key)}&rt=${encodeURIComponent(rt)}` +
      `&stpid=${encodeURIComponent(stpid)}&top=${encodeURIComponent(top)}`;

    const r = await fetch(url, { headers: { 'User-Agent': 'ctatracker/1.0 (+vercel)' } });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
