export const runtime = 'edge';

export default async function handler(req){
  const { searchParams } = new URL(req.url);
  const rt = searchParams.get('rt') || '77';
  const key = process.env.CTA_BUS_KEY;
  if (!key) return new Response(JSON.stringify({ directions: [], error: 'Missing CTA_BUS_KEY' }), { status: 500 });

  const url = `https://www.ctabustracker.com/bustime/api/v3/getdirections?format=json&key=${key}&rt=${encodeURIComponent(rt)}`;
  const r = await fetch(url);
  const json = await r.json();
  const err = json?.bustime_response?.error?.[0]?.msg ?? null;
  const directions = json?.bustime_response?.directions ?? [];
  return new Response(JSON.stringify({ directions, error: err }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
