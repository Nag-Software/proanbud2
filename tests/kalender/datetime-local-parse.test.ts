import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Regression guard for the Safari calendar timezone bug. The edit dialog's
// <input type="datetime-local"> emits a bare "YYYY-MM-DDTHH:mm" string with no
// timezone offset. `new Date(thatString)` is NOT portable: V8 (Chrome) parses it
// as LOCAL time, but JavaScriptCore (Safari) parses it as UTC — so on Safari the
// saved event time is shifted by the user's offset (1-2h in Norway) and that
// wrong value is persisted via toISOString() and synced to Google/Tripletex.
// The fix parses the components explicitly via the local-time Date constructor
// (parseLocalDatetimeInput), which is identical across engines.
describe('kalender datetime-local parsing (Safari timezone safety)', () => {
  const page = readFileSync(
    resolve(__dirname, '../../app/kalender/page.tsx'),
    'utf-8'
  )
  // Kalenderen bruker nå DateTimeField (DatePicker + klokkeslett); tolkningen bor der.
  const field = readFileSync(
    resolve(__dirname, '../../components/ui/date-time-field.tsx'),
    'utf-8'
  )

  it('does NOT pass a raw input value into new Date()', () => {
    // The Safari-divergent pattern: new Date(e.target.value) on a date/time string.
    expect(page).not.toMatch(/new Date\(\s*e(vent)?\.target\.value\s*\)/)
    expect(field).not.toMatch(/new Date\(\s*e(vent)?\.target\.value\s*\)/)
    expect(page).not.toContain('type="datetime-local"')
  })

  it('builds dates with the local-time constructor', () => {
    expect(page).toContain('<DateTimeField')
    // new Date(y, m, d, ...) is local time in every engine — never the string parser.
    expect(field).toMatch(/new Date\(\s*year,\s*month - 1,\s*day,\s*hour,\s*minute/)
  })
})
