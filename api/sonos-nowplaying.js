// api/sonos-nowplaying.js
// Node (NOT Edge) because we use client secret.
// Env vars required in Vercel:
// SONOS_CLIENT_ID, SONOS_CLIENT_SECRET, SONOS_REFRESH_TOKEN
// Optional (recommended): SONOS_HOUSEHOLD_ID, SONOS_GROUP_ID

export const config = { runtime: 'nodejs18.x' };

const TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';
const CTRL_BASE = 'https://api.ws.sonos.com/control/api/v1';

async function refreshAccessToken() {
  const id = process.env.SONOS_CLIENT_ID;
  const secret = process.env.SONOS_CLIENT_SECRET;
  const refresh = process.env.SONOS_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    return { error: 'Missing Sonos env vars' };
  }

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  if (!r.ok) return { error: `Token refresh failed (${r.status})` };
  const j = await r.json();
  return { accessToken: j.access_token };
}

async function getJSON(url, accessToken) {
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    const { accessToken, error } = await refreshAccessToken();
    if (error) return res.status(500).json({ error });

    // Resolve household
    let householdId = process.env.SONOS_HOUSEHOLD_ID;
    if (!householdId) {
      const hh = await getJSON(`${CTRL_BASE}/households`, accessToken);
      householdId = hh?.households?.[0]?.id || null;
    }
    if (!householdId) {
      return res.status(404).json({ error: 'No household found' });
    }

    // Get groups for the household
    const groupsObj = await getJSON(
      `${CTRL_BASE}/households/${householdId}/groups`,
      accessToken
    );

    const preferredGroupId = process.env.SONOS_GROUP_ID;
    let group =
      groupsObj?.groups?.find(g => g.id === preferredGroupId) ||
      groupsObj?.groups?.find(g => g.playbackState === 'PLAYBACK_STATE_PLAYING') ||
      groupsObj?.groups?.[0];

    if (!group) return res.status(404).json({ error: 'No groups available' });

    // Get playback metadata for that group
    const meta = await getJSON(
      `${CTRL_BASE}/groups/${group.id}/playbackMetadata`,
      accessToken
    );

    const item = meta?.currentItem; // Playback object (track info, art, service name, etc.)

    // Normalize a small, safe payload for your UI
    const out = {
      groupId: group.id,
      groupPlaybackState: group.playbackState,
      title: item?.track?.name || item?.name || null,
      artist: item?.track?.artist?.name || null,
      album: item?.track?.album?.name || null,
      imageUrl: item?.track?.imageUrl || item?.imageUrl || null,
      service: item?.service?.name || null,
      // Helpful booleans
      isPlaying: group.playbackState === 'PLAYBACK_STATE_PLAYING',
    };

    res.setHeader('cache-control', 'no-store');
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
