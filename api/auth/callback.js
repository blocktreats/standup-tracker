const {
  exchangeCodeForTokens,
  decodeIdToken,
  storeOrgToken,
} = require('../_lib/oauth-tokens');

const ALLOWED_ORIGINS = [
  'https://standup-tracker-three.vercel.app',
  'http://localhost:3000',
  'http://localhost:5000',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code, error: oauthError, state } = req.query;

  // Determine base URL for redirect
  const origin = ALLOWED_ORIGINS.find(o => req.headers.referer?.startsWith(o))
    || ALLOWED_ORIGINS[0];

  if (oauthError) {
    return res.redirect(302, `${origin}/setup.html?error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return res.redirect(302, `${origin}/setup.html?error=no_code`);
  }

  try {
    const redirectUri = `${origin}/api/auth/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      return res.redirect(302, `${origin}/setup.html?error=no_refresh_token`);
    }

    // Extract user info from id_token
    const userInfo = decodeIdToken(tokens.id_token);
    const email = userInfo.email;
    const domain = userInfo.hd || email.split('@')[1]; // hd = hosted domain for Workspace accounts

    await storeOrgToken(
      domain,
      email,
      tokens.refresh_token,
      tokens.access_token,
      tokens.expires_in
    );

    return res.redirect(302, `${origin}/setup.html?success=true&domain=${encodeURIComponent(domain)}`);
  } catch (err) {
    console.error('OAuth callback error:', err.message || err);
    return res.redirect(302, `${origin}/setup.html?error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
