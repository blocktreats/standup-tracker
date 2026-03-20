const { getAccessToken } = require('./_lib/google-auth');
const { getAllOrgTokens, getOrgAccessToken } = require('./_lib/oauth-tokens');

const ALLOWED_ORIGINS = [
  'https://standup-tracker-three.vercel.app',
  'http://localhost:3000',
  'http://localhost:5000',
];

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { meetingCode } = req.query;
  if (!meetingCode || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(meetingCode)) {
    return res.status(400).json({ error: 'Invalid meetingCode' });
  }

  try {
    // 1. Try the service account first (your org)
    let result = await fetchParticipantsWithToken(meetingCode, await getAccessToken());
    if (result.length > 0) {
      return res.status(200).json({ participants: result });
    }

    // 2. Try stored org tokens
    const orgTokens = await getAllOrgTokens();
    for (const orgToken of orgTokens) {
      try {
        const accessToken = await getOrgAccessToken(orgToken);
        if (!accessToken) continue;

        result = await fetchParticipantsWithToken(meetingCode, accessToken);
        if (result.length > 0) {
          return res.status(200).json({ participants: result });
        }
      } catch (err) {
        console.warn(`Token for ${orgToken.domain} failed:`, err.message);
      }
    }

    // 3. No token found participants — return empty
    return res.status(200).json({ participants: [] });
  } catch (err) {
    console.error('Meet API error:', err.message || err);
    return res.status(500).json({ error: 'Failed to fetch participants', detail: err.message || String(err) });
  }
};

async function fetchParticipantsWithToken(meetingCode, token) {
  // Find conference record for this meeting code
  const crResp = await fetch(
    'https://meet.googleapis.com/v2/conferenceRecords?filter=space.meeting_code%3D' + meetingCode,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const crData = await crResp.json();

  if (crData.error || !crData.conferenceRecords || crData.conferenceRecords.length === 0) {
    return [];
  }

  const record = crData.conferenceRecords[crData.conferenceRecords.length - 1];

  // Fetch all participants (paginated)
  let allParticipants = [];
  let nextPageToken = null;
  do {
    let url = 'https://meet.googleapis.com/v2/' + record.name + '/participants?pageSize=100';
    if (nextPageToken) url += '&pageToken=' + encodeURIComponent(nextPageToken);
    const pResp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const pData = await pResp.json();
    if (pData.participants) allParticipants = allParticipants.concat(pData.participants);
    nextPageToken = pData.nextPageToken || null;
  } while (nextPageToken);

  // Extract display names and deduplicate
  const seen = new Set();
  const result = [];
  for (const p of allParticipants) {
    let displayName = null;
    let participantId = null;

    if (p.signedinUser) {
      displayName = p.signedinUser.displayName;
      const userId = (p.signedinUser.user || '').replace('users/', '');
      if (userId) participantId = 'google-' + userId;
    } else if (p.anonymousUser) {
      displayName = p.anonymousUser.displayName;
    } else if (p.phoneUser) {
      displayName = p.phoneUser.displayName;
    }

    if (!displayName) continue;
    if (!participantId) participantId = 'meet-' + displayName.toLowerCase().replace(/\s+/g, '-');
    if (seen.has(participantId)) continue;
    seen.add(participantId);
    result.push({ id: participantId, name: displayName });
  }

  return result;
}
