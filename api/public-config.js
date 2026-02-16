// api/public-config.js
// Returns public (non-secret) configuration for the client portal.
// Only exposes SUPABASE_URL and SUPABASE_ANON_KEY — both are
// designed to be public and are protected by Row Level Security.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({
      error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in environment variables.'
    });
  }

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey
  });
};
