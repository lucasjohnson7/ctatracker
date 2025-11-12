export const config = { runtime: 'edge' };

async function refreshAccessToken() {
  const rt = process.env.SONOS_REFRESH_TOKEN;
  if (!rt) throw new Error('Missing SONOS_REFRESH_TOKEN');
  const basic = btoa(`${process.env.SONOS_CLIENT_ID}:${process.env.SONOS_CLIENT_SECRET}`);
  const r = await fetch('https://api.sonos.com/login/v3/oauth/access', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rt
    })
  });
  if(!r.ok) throw new Error(`Refresh HTTP ${r.status}`);
  return r.json();
}

async function api(path, token){
  const r = await fetch(`https://api.ws.sonos.com/control/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if(!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

export default async function handler() {
  try {
    const { access_token } = await refreshAccessToken();

    // find first active group in household
    const { households } = await api('/households', access_token);
    if (!households?.length) return new Response(JSON.stringify({ playing:false }), { headers:{'content-type':'application/json'} });

    const hh = households[0].id;
    const { groups } = await api(`/households/${hh}/groups`, access_token);
    if (!groups?.length) return new Response(JSON.stringify({ playing:false }), { headers:{'content-type':'application/json'} });

    // Try group-level metadata first; fall back to player metadata if needed
    const group = groups[0];
    let meta;

    try {
      meta = await api(`/groups/${group.id}/playbackMetadata`, access_token);
    } catch {
      // fallback: pick first player
      const playerId = group.playerIds?.[0];
      if (playerId) meta = await api(`/players/${playerId}/playback/metadata`, access_token);
    }

    const status = await api(`/groups/${group.id}/playback`, access_token).catch(()=>({}));

    const title   = meta?.currentItem?.track?.name || meta?.container?.name || null;
    const artist  = meta?.currentItem?.track?.artist?.name || null;
    const album   = meta?.currentItem?.track?.album?.name || null;
    const image   = meta?.currentItem?.track?.imageUrl || meta?.container?.imageUrl || null;
    const isPlaying = status?.playbackState === 'PLAYBACK_STATE_PLAYING';

    return new Response(JSON.stringify({
      playing: Boolean(title || artist),
      isPlaying, title, artist, album, image, groupName: group.name
    }), { headers: { 'content-type': 'application/json', 'cache-control':'no-store' }});

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers:{'content-type':'application/json'} });
  }
}
