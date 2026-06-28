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

  it('does NOT pass the raw datetime-local input value into new Date()', () => {
    // The Safari-divergent pattern: new Date(e.target.value) on a datetime-local
    // string. It must not reappear in any onChange handler.
    expect(page).not.toMatch(/new Date\(\s*e\.target\.value\s*\)/)
  })

  it('parses datetime-local input via the local-time helper', () => {
    expect(page).toContain('parseLocalDatetimeInput(e.target.value)')
    // The helper must use the local-time Date constructor (new Date(y, m, d, ...)),
    // which every engine interprets as local time — never the string parser.
    expect(page).toMatch(/new Date\(\s*year,\s*month - 1,\s*day,\s*hour,\s*minute/)
  })
})
