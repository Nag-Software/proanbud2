require('dotenv').config({ path: '.env.local' });
console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("KEY begins with:", process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 10) : 'MISSING');
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
admin.from('companies').select('*').limit(1).then(r => console.log('Response:', JSON.stringify(r))).catch(console.error);