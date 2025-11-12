export const config = { runtime: 'edge' };

async function tokenExchange(body) {
  const basic = btoa(`${process.env.SONOS_CLIENT_ID}:${process.env.SONOS_CLIENT_SECRET}`);
  const r = await fetch('https://api.sonos.com/login/v3/oauth/access', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body)
  });
  if(!r.ok) throw new Error(`Token HTTP ${r.status}`);
  return r.json();
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    if (!code) return new Response('Missing code', { status: 400 });

    const data = await tokenExchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SONOS_REDIRECT_URI
    });

    // Show the refresh token once so you can copy it into Vercel env:
    const html = `
      <pre style="font:14px/1.4 monospace">
Access token (temporary): ${data.access_token}

REFRESH TOKEN (save to Vercel as SONOS_REFRESH_TOKEN):
${data.refresh_token}

After you save it, redeploy, then visit /api/sonos/now-playing.
      </pre>`;
    return new Response(html, { headers: { 'content-type': 'text/html' }});
  } catch (e) {
    return new Response('Callback error: ' + e.message, { status: 500 });
  }
}
