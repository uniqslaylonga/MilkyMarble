const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Kulang ang SUPABASE_URL o SUPABASE_KEY sa iyong .env file!');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[Notice] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. ' +
    'Server-side inserts/updates (like signup) will be blocked by Row Level Security ' +
    'unless RLS policies explicitly allow the anon role, or you set the service role key.'
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;