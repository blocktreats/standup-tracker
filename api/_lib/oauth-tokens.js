const { createClient } = require('@supabase/supabase-js');

const SCOPES = ['https://www.googleapis.com/auth/meetings.space.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Supabase client with service role key (bypasses RLS)
let sbAdmin = null;
function getSupabaseAdmin() {
  if (!sbAdmin) {
    sbAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return sbAdmin;
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code, redirectUri) {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await resp.json();
  if (data.error) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  }
  return data; // { access_token, refresh_token, expires_in, id_token, ... }
}

// Decode JWT id_token to get email (no verification needed — we just got it from Google)
function decodeIdToken(idToken) {
  const payload = idToken.split('.')[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return decoded; // { email, name, hd (hosted domain), sub, ... }
}

// Store org token in Supabase
async function storeOrgToken(domain, email, refreshToken, accessToken, expiresIn) {
  const sb = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

  const { error } = await sb
    .from('org_tokens')
    .upsert({
      domain,
      email,
      refresh_token: refreshToken,
      access_token: accessToken,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'domain' });

  if (error) throw new Error(`Failed to store token: ${error.message}`);
}

// Get all stored org tokens
async function getAllOrgTokens() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('org_tokens')
    .select('domain, email, refresh_token, access_token, token_expires_at');

  if (error) {
    console.error('Failed to fetch org tokens:', error.message);
    return [];
  }
  return data || [];
}

// Get a valid access token for an org, refreshing if needed
async function getOrgAccessToken(orgToken) {
  // Check if current token is still valid (with 60s buffer)
  const expiresAt = new Date(orgToken.token_expires_at).getTime();
  if (orgToken.access_token && Date.now() < expiresAt) {
    return orgToken.access_token;
  }

  // Refresh the token
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: orgToken.refresh_token,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await resp.json();
  if (data.error) {
    console.error(`Token refresh failed for ${orgToken.domain}:`, data.error);
    return null;
  }

  // Update stored token
  const sb = getSupabaseAdmin();
  const expiresAtNew = new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString();
  await sb
    .from('org_tokens')
    .update({
      access_token: data.access_token,
      token_expires_at: expiresAtNew,
      updated_at: new Date().toISOString(),
    })
    .eq('domain', orgToken.domain);

  return data.access_token;
}

// Delete an org token (for disconnect flow)
async function deleteOrgToken(domain) {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from('org_tokens')
    .delete()
    .eq('domain', domain);
  if (error) throw new Error(`Failed to delete token: ${error.message}`);
}

module.exports = {
  exchangeCodeForTokens,
  decodeIdToken,
  storeOrgToken,
  getAllOrgTokens,
  getOrgAccessToken,
  deleteOrgToken,
  SCOPES,
};
