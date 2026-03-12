const { JWT } = require('google-auth-library');

const SCOPES = ['https://www.googleapis.com/auth/meetings.space.readonly'];

let cachedClient = null;

async function getAccessToken() {
  if (!cachedClient) {
    const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    cachedClient = new JWT({
      email: keyData.client_email,
      key: keyData.private_key,
      scopes: SCOPES,
      subject: process.env.GOOGLE_IMPERSONATE_EMAIL,
    });
  }
  const { token } = await cachedClient.getAccessToken();
  return token;
}

module.exports = { getAccessToken };
