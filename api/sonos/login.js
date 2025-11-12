export const runtime = 'edge';

function qs(obj){ return new URLSearchParams(obj).toString(); }

export default async function handler() {
  const clientId = process.env.SONOS_CLIENT_ID;
  const redirectUri = process.env.SONOS_REDIRECT_URI;
  const scope = 'playback-control-all'; // broad; covers read/control

  const state = crypto.randomUUID();
  const url = `https://api.sonos.com/login/v3/oauth/authorize?` + qs({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state
  });

  return new Response(null, { status: 302, headers: { Location: url }});
}
