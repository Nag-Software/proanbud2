const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  // Sjekk hvem som har rettigheter
  const res = await client.query(`
    SELECT grantee, privilege_type 
    FROM information_schema.role_table_grants 
    WHERE table_name='companies';
  `);
  console.log("Current Grants on companies:");
  console.table(res.rows);

  // Fiks rettigheter for alle tabeller
  console.log("Fixing grants for service_role and anon/authenticated...");
  await client.query(`
    GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;
  `);

  const res2 = await client.query(`
    SELECT grantee, privilege_type 
    FROM information_schema.role_table_grants 
    WHERE table_name='companies';
  `);
  console.log("New Grants on companies:");
  console.table(res2.rows);

  await client.end();
}

run().catch(console.dir);