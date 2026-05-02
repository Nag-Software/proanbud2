import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const schemaPath = resolve(__dirname, '../../db/schema.sql')
const schema = readFileSync(schemaPath, 'utf-8')

describe('database schema', () => {
  it('contains calendar_integrations table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS calendar_integrations')
  })

  it('contains user_profiles table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS user_profiles')
  })
})
