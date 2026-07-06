import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

// The schema lives as numbered migrations in db/ (no consolidated schema.sql),
// so "the schema" is the concatenation of every migration file.
const dbDir = resolve(__dirname, '../../db')
const schema = readdirSync(dbDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(resolve(dbDir, file), 'utf-8'))
  .join('\n')

describe('database schema', () => {
  it('contains calendar_integrations table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.calendar_integrations')
  })

  it('contains user_profiles table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.user_profiles')
  })
})
