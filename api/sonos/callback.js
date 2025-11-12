export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });

  const clientId = process.env.SONOS_CLIENT_ID;
  const clientSecret = process.env.SONOS_CLIENT_SECRET;
  const redirectUri = process.env.SONOS_REDIRECT_URI;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const r = await fetch('https://api.sonos.com/login/v3/oauth/access', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await r.json();
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}
