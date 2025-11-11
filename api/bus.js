// Vercel Edge Function — CTA Bus Tracker v3 → JSON
// Requires env: CTA_BUS_KEY
export const config = { runtime: 'edge' };


export default async function handler(req) {
const { searchParams } = new URL(req.url);
const stpid = searchParams.get('stpid');
const rt = searchParams.get('rt') || '77';
const top = searchParams.get('top') || '6';
const key = process.env.CTA_BUS_KEY;
if(!key) return new Response(JSON.stringify({ error: 'Missing CTA_BUS_KEY' }), { status: 500 });
if(!stpid) return new Response(JSON.stringify({ error: 'Missing stpid' }), { status: 400 });


const url = `https://www.ctabustracker.com/bustime/api/v3/getpredictions?format=json&key=${key}&rt=${rt}&stpid=${stpid}&top=${top}`;
const r = await fetch(url);
if(!r.ok) return new Response(JSON.stringify({ error: 'CTA Bus API error' }), { status: 502 });
const json = await r.json();
const rows = json?.bustime_response?.prd || [];
return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}