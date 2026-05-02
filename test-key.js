const dot = require('dotenv').config({ path: '.env.local' });
console.log(process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 10) + '...' : 'MISSING');
