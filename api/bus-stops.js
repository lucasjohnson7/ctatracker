// Helper: list stops for a route + direction so you can confirm stpid values
// Usage: /api/bus-stops?rt=77&dir=Eastbound (or Westbound)
export const config = { runtime: 'edge' };


export default async function handler(req){
const { searchParams } = new URL(req.url);
const rt = searchParams.get('rt') || '77';
const dir = searchParams.get('dir'); // optional
const key = process.env.CTA_BUS_KEY;
if(!key) return new Response(JSON.stringify({ error: 'Missing CTA_BUS_KEY' }), { status: 500 });


const base = `https://www.ctabustracker.com/bustime/api/v3/getstops?format=json&key=${key}&rt=${rt}`;
const url = dir ? `${base}&dir=${encodeURIComponent(dir)}` : base;
const r = await fetch(url);
const json = await r.json();
const err = json?.bustime_response?.error?.[0]?.msg || null;
const stops = json?.bustime_response?.stops || [];
return new Response(JSON.stringify({ stops, error: err }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}