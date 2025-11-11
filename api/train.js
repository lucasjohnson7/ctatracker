// Vercel serverless function — CTA Train Tracker → JSON
// Requires env: CTA_TRAIN_KEY
import { xml2js } from 'xml-js';


export const config = { runtime: 'edge' };


export default async function handler(req) {
const { searchParams } = new URL(req.url);
const mapid = searchParams.get('mapid') || '40360'; // Southport
const key = process.env.CTA_TRAIN_KEY;
if(!key) return new Response(JSON.stringify({ error: 'Missing CTA_TRAIN_KEY' }), { status: 500 });


const url = `http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=${key}&mapid=${mapid}`;
const r = await fetch(url);
if(!r.ok) return new Response(JSON.stringify({ error: 'CTA Train API error' }), { status: 502 });
const xml = await r.text();
const json = xml2js(xml, { compact: true });
// Flatten to friendlier array
const etas = json?.ctatt?.eta ? (Array.isArray(json.ctatt.eta) ? json.ctatt.eta : [json.ctatt.eta]) : [];
const rows = etas.map(e => ({
staId: e.staId?._text, stpId: e.stpId?._text, stpDe: e.stpDe?._text, staNm: e.staNm?._text,
rn: e.rn?._text, destNm: e.destNm?._text, arrT: e.arrT?._text, isApp: e.isApp?._text === '1', isDly: e.isDly?._text === '1'
}));


return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}