const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  await client.query(`
    ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS org_number TEXT,
    ADD COLUMN IF NOT EXISTS postal_code TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT;
  `);
  
  console.log("Added columns to customers");
  await client.end();
}
run();