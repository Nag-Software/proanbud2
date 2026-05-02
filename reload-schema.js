const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log("PostgREST schema cache reloaded");
  await client.end();
}
run();