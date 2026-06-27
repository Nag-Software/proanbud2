/**
 * CORS for the public affiliate endpoints. The marketing site (www.proanbud.no)
 * calls these cross-origin, so we echo any *.proanbud.no (or localhost) origin
 * and answer the preflight. Shared by /api/affiliate/apply and /api/affiliate/click.
 */

function resolveOrigin(origin: string | null): string {
  if (origin) {
    try {
      const host = new URL(origin).hostname
      if (host === "proanbud.no" || host.endsWith(".proanbud.no") || host === "localhost") {
        return origin
      }
    } catch {
      // fall through to default
    }
  }
  return "https://www.proanbud.no"
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}
