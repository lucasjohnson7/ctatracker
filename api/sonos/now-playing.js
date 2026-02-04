// api/sonos/now-playing.js
export const config = { runtime: "edge" };

// Node-safe base64 helper (btoa isn't available in Node by default)
function base64(str) {
  // Buffer exists in Node; in Edge it may not, so fall back to btoa if present
  if (typeof Buffer !== "undefined") return Buffer.from(str, "utf8").toString("base64");
  if (typeof btoa !== "undefined") return btoa(str);
  throw new Error("No base64 encoder available");
}

async function refreshAccessToken() {
  const rt = process.env.SONOS_REFRESH_TOKEN;
  const id = process.env.SONOS_CLIENT_ID;
  const secret = process.env.SONOS_CLIENT_SECRET;

  if (!rt) throw new Error("Missing SONOS_REFRESH_TOKEN");
  if (!id) throw new Error("Missing SONOS_CLIENT_ID");
  if (!secret) throw new Error("Missing SONOS_CLIENT_SECRET");

  const basic = base64(`${id}:${secret}`);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
  });

  const r = await fetch("https://api.sonos.com/login/v3/oauth/access", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // safest cross-runtime: send string
    body: body.toString(),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Refresh HTTP ${r.status} ${text}`.trim());
  }

  return r.json();
}

async function api(path, token) {
  const r = await fetch(`https://api.ws.sonos.com/control/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${path} HTTP ${r.status} ${text}`.trim());
  }

  return r.json();
}

export default async function handler() {
  try {
    const { access_token } = await refreshAccessToken();

    // households
    const { households } = await api("/households", access_token);
    if (!households?.length) {
      return new Response(JSON.stringify({ playing: false }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // groups
    const hh = households[0].id;
    const { groups } = await api(`/households/${hh}/groups`, access_token);
    if (!groups?.length) {
      return new Response(JSON.stringify({ playing: false }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    const group = groups[0];

    // metadata (group first, then player fallback)
    let meta = null;
    try {
      meta = await api(`/groups/${group.id}/playbackMetadata`, access_token);
    } catch {
      const playerId = group.playerIds?.[0];
      if (playerId) {
        meta = await api(`/players/${playerId}/playback/metadata`, access_token);
      }
    }

    // playback status (for play state + position/duration if available)
    const status = await api(`/groups/${group.id}/playback`, access_token).catch(() => ({}));

    const title = meta?.currentItem?.track?.name || meta?.container?.name || null;
    const artist = meta?.currentItem?.track?.artist?.name || null;
    const album = meta?.currentItem?.track?.album?.name || null;
    const image = meta?.currentItem?.track?.imageUrl || meta?.container?.imageUrl || null;

    const isPlaying = status?.playbackState === "PLAYBACK_STATE_PLAYING";

    // Optional progress fields for your UI (safe defaults)
    const positionMs = Number.isFinite(status?.positionMillis) ? status.positionMillis : null;
    const durationMs = Number.isFinite(meta?.currentItem?.track?.durationMillis)
      ? meta.currentItem.track.durationMillis
      : null;

    return new Response(
      JSON.stringify({
        playing: Boolean(title || artist),
        isPlaying,
        title,
        artist,
        album,
        image,
        groupName: group?.name || null,
        positionMs,
        durationMs,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
