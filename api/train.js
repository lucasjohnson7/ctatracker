// Vercel Edge Function — CTA Train Tracker → JSON (no XML parser needed)
// Requires env: CTA_TRAIN_KEY
export const config = { runtime: 'edge' };


export default async function handler(req) {
try {
const { searchParams } = new URL(req.url);
const mapid = searchParams.get('mapid') || '40360'; // Southport
const key = process.env.CTA_TRAIN_KEY;
if (!key) return new Response(JSON.stringify({ error: 'Missing CTA_TRAIN_KEY' }), { status: 500 });


// Ask CTA for JSON directly via outputType=JSON (documented in Train Tracker API)
const url = `http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=${key}&mapid=${mapid}&outputType=JSON`;
const r = await fetch(url);
if (!r.ok) return new Response(JSON.stringify({ error: 'CTA Train API error' }), { status: 502 });
const payload = await r.json();
const etas = payload?.ctatt?.eta ? (Array.isArray(payload.ctatt.eta) ? payload.ctatt.eta : [payload.ctatt.eta]) : [];


const rows = etas.map(e => ({
staId: e.staId, stpId: e.stpId, stpDe: e.stpDe, staNm: e.staNm,
rn: e.rn, destNm: e.destNm, arrT: e.arrT, isApp: e.isApp === '1', isDly: e.isDly === '1'
}));


return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
} catch (err) {
return new Response(JSON.stringify({ error: 'Unhandled error', detail: String(err) }), { status: 500 });
}
}