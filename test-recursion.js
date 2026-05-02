const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`
    select schemaname, tablename, policyname, qual from pg_policies where tablename = 'project_members';
  `);
  console.table(res.rows);
  await client.end();
}
run();