#!/usr/bin/env node
// Lettvekts, idempotent migrasjonskjører for db/NN_*.sql.
// Bruker `pg` (allerede en dependency) og en schema_migrations-tabell for å
// spore hvilke filer som er kjørt. Ingen ORM/CLI.
//
// Bruk:
//   DATABASE_URL=postgres://... npm run db:migrate            # kjør ventende
//   DATABASE_URL=postgres://... npm run db:migrate -- --dry-run   # vis ventende, gjør ingenting
//   DATABASE_URL=postgres://... npm run db:migrate:baseline   # merk alle nåværende filer som kjørt UTEN å kjøre
//
// VIKTIG — FØRSTE GANG på en database som allerede er migrert manuelt:
// kjør `npm run db:migrate:baseline` ÉN gang først. Det registrerer de
// eksisterende db/*.sql som "applied" så de ikke kjøres på nytt. Å re-kjøre dem
// ville vært destruktivt (f.eks. db/26 starter med DROP TABLE).
//
// Bruk Supabase sin DIREKTE Postgres-connection (ikke pooler) for DDL.

import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import pg from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
const DB_DIR = path.resolve(here, "..", "db")

const flags = new Set(process.argv.slice(2))
const BASELINE = flags.has("--baseline")
const DRY_RUN = flags.has("--dry-run")

const { DATABASE_URL } = process.env
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL mangler. Legg den i .env.local.\n" +
      "Hentes fra Supabase → Project Settings → Database → Connection string (URI).\n" +
      "Bruk 'Session pooler' (port 5432) eller 'Direct connection' — IKKE transaction pooler (6543) for migrasjoner.\n" +
      "Merk: dette er databasepassordet, ikke service_role-nøkkelen.",
  )
  process.exit(1)
}

async function main() {
  const entries = await readdir(DB_DIR)
  const files = entries.filter((f) => f.endsWith(".sql")).sort()
  if (files.length === 0) {
    console.log("Ingen .sql-filer i db/.")
    return
  }

  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const { rows } = await client.query("SELECT filename FROM schema_migrations")
    const applied = new Set(rows.map((r) => r.filename))
    const pending = files.filter((f) => !applied.has(f))

    if (pending.length === 0) {
      console.log("Alt er oppdatert — ingen ventende migrasjoner.")
      return
    }

    if (BASELINE) {
      for (const f of pending) {
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
          [f],
        )
      }
      console.log(`Baseline: merket ${pending.length} fil(er) som allerede kjørt (ingen SQL utført):`)
      pending.forEach((f) => console.log(`  ✓ ${f}`))
      return
    }

    if (DRY_RUN) {
      console.log(`Ventende migrasjoner (${pending.length}):`)
      pending.forEach((f) => console.log(`  • ${f}`))
      return
    }

    for (const f of pending) {
      const sql = await readFile(path.join(DB_DIR, f), "utf8")
      process.stdout.write(`→ kjører ${f} ... `)
      try {
        await client.query("BEGIN")
        await client.query(sql)
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f])
        await client.query("COMMIT")
        console.log("OK")
      } catch (err) {
        await client.query("ROLLBACK")
        console.log("FEIL")
        throw new Error(`Migrasjon ${f} feilet (rullet tilbake): ${err.message}`)
      }
    }
    console.log(`Ferdig: ${pending.length} migrasjon(er) kjørt.`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
