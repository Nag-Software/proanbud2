import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative, resolve } from "path"

// db/80 fjernet UPDATE på hele public.users og ga bare én kolonne tilbake til
// rollen `authenticated`. Alt annet må skrives med service_role. Denne testen
// leser fasiten ut av migrasjonen selv, slik at den følger med hvis grantet
// endres, og skanner kildekoden for skrivinger som bryter den.
const root = resolve(__dirname, "../..")
const migration = readFileSync(resolve(root, "db/80_critical_security_hardening.sql"), "utf-8")

function grantedUpdateColumns(): Set<string> {
  const match = migration.match(/GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+public\.users\s+TO\s+authenticated/i)
  if (!match) throw new Error("db/80 mangler kolonne-grantet på public.users")
  return new Set(match[1].split(",").map((column) => column.trim()))
}

const ALLOWED_FOR_AUTHENTICATED = grantedUpdateColumns()

const SOURCE_DIRS = ["app", "lib", "components"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".claude"])

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(full)) files.push(full)
  }
  return files
}

function objectLiteralAfter(source: string, start: number): string | null {
  const open = source.indexOf("{", start)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++
    else if (source[i] === "}") {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

function topLevelKeys(objectBody: string): string[] {
  const keys: string[] = []
  let depth = 0
  let expectKey = true
  let token = ""
  for (let i = 0; i < objectBody.length; i++) {
    const char = objectBody[i]
    if ("{[(".includes(char)) depth++
    else if ("}])".includes(char)) depth--
    else if (depth === 0 && char === ":" && expectKey) {
      keys.push(token.trim().replace(/['"]/g, ""))
      expectKey = false
      token = ""
      continue
    } else if (depth === 0 && char === ",") {
      expectKey = true
      token = ""
      continue
    }
    if (depth === 0 && expectKey) token += char
  }
  return keys.filter(Boolean)
}

// Klienten som utfører skrivingen: uttrykket rett foran `.from("users")`.
// Håndterer både `admin.from(...)` og `createAdminClient().from(...)`.
function receiverBefore(source: string, fromIndex: number): string {
  let end = fromIndex
  while (end > 0 && /[\s.]/.test(source[end - 1])) end--

  if (source[end - 1] === ")") {
    let depth = 0
    let i = end - 1
    for (; i >= 0; i--) {
      if (source[i] === ")") depth++
      else if (source[i] === "(") {
        depth--
        if (depth === 0) break
      }
    }
    end = i
  }

  const head = source.slice(Math.max(0, end - 120), end)
  return head.match(/[A-Za-z0-9_$]+$/)?.[0] ?? ""
}

// lib/company-roles.ts får klienten injisert som parameter, så den kan ikke
// klassifiseres her. Kallstedene dekkes av «rolleendring bruker service_role».
const INJECTED_CLIENT_FILES = new Set(["lib/company-roles.ts"])

const ADMIN_RECEIVER = /admin|service/i

type Write = { file: string; line: number; receiver: string; columns: string[] }

function collectUsersUpdates(): Write[] {
  const writes: Write[] = []
  const pattern = /\.from\(\s*['"]users['"]\s*\)\s*\.\s*update\(/g
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(resolve(root, dir))) {
      const source = readFileSync(file, "utf-8")
      for (const match of source.matchAll(pattern)) {
        const body = objectLiteralAfter(source, match.index! + match[0].length - 1)
        if (body === null) continue
        writes.push({
          file: relative(root, file),
          line: source.slice(0, match.index).split("\n").length,
          receiver: receiverBefore(source, match.index!),
          columns: topLevelKeys(body),
        })
      }
    }
  }
  return writes
}

describe("public.users kolonne-grants (db/80)", () => {
  const writes = collectUsersUpdates()

  it("finner faktiske users-skrivinger å sjekke", () => {
    expect(writes.length).toBeGreaterThan(0)
  })

  it("gir bare full_name til innloggede brukere", () => {
    expect([...ALLOWED_FOR_AUTHENTICATED]).toEqual(["full_name"])
  })

  it("skriver ingen ikke-grantet kolonne med brukerens egen sesjon", () => {
    const violations = writes
      .filter((write) => !INJECTED_CLIENT_FILES.has(write.file))
      .filter((write) => !ADMIN_RECEIVER.test(write.receiver))
      .filter((write) => write.columns.some((column) => !ALLOWED_FOR_AUTHENTICATED.has(column)))
      .map((write) => `${write.file}:${write.line} skriver [${write.columns.join(", ")}] via '${write.receiver}'`)

    expect(violations).toEqual([])
  })

  it("hvert users-write har kolonner vi klarte å lese ut", () => {
    expect(writes.filter((write) => write.columns.length === 0)).toEqual([])
  })
})

describe("rolleendring bruker service_role", () => {
  const companyRoles = readFileSync(resolve(root, "lib/company-roles.ts"), "utf-8")
  const callSites = sourceFiles(resolve(root, "app"))
    .map((file) => ({ file: relative(root, file), source: readFileSync(file, "utf-8") }))
    .flatMap(({ file, source }) =>
      [...source.matchAll(/assignUserRole\(\s*([A-Za-z0-9_.()]+)/g)].map((match) => ({
        file,
        line: source.slice(0, match.index).split("\n").length,
        client: match[1],
      }))
    )

  it("assignUserRole skriver fortsatt users.role", () => {
    expect(companyRoles).toMatch(/from\(["']users["']\)[\s\S]{0,60}role:/)
  })

  it("alle kallsteder sender en service_role-klient", () => {
    expect(callSites.length).toBeGreaterThan(0)
    const violations = callSites
      .filter((site) => !ADMIN_RECEIVER.test(site.client))
      .map((site) => `${site.file}:${site.line} kaller assignUserRole(${site.client})`)

    expect(violations).toEqual([])
  })
})
