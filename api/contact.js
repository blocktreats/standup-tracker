const ALLOWED_ORIGINS = [
  'https://standup-tracker-three.vercel.app',
  'http://localhost:3000',
  'http://localhost:5000',
];

const FORWARD_TO = 'nathan@watership.ca';

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, type, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Use Supabase to store the message (acts as a simple inbox)
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await sb.from('support_messages').insert({
      name,
      email,
      type: type || 'other',
      message,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err.message || err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
