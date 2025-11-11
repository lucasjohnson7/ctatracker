export const runtime = 'edge';

export default async function handler(req){
  const { searchParams } = new URL(req.url);
  const rt = searchParams.get('rt') || '77';
  const dir = searchParams.get('dir'); // e.g. "Eastbound", "Westbound" (exact string from getdirections)
  const key = process.env.CTA_BUS_KEY;
  if (!key) return new Response(JSON.stringify({ stops: [], error: 'Missing CTA_BUS_KEY' }), { status: 500 });

  const base = `https://www.ctabustracker.com/bustime/api/v3/getstops?format=json&key=${key}&rt=${encodeURIComponent(rt)}`;
  const url = dir ? `${base}&dir=${encodeURIComponent(dir)}` : base;

  const r = await fetch(url);
  const json = await r.json();
  const err = json?.bustime_response?.error?.[0]?.msg ?? null;
  const stops = json?.bustime_response?.stops ?? [];
  return new Response(JSON.stringify({ stops, error: err }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
