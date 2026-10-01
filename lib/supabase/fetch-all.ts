type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Henter alle rader, side for side. PostgREST kutter stille ved 1000 rader, så en
 * spørring uten dette ser komplett ut helt til bedriften har vokst forbi grensen.
 *
 * Spørringen MÅ ha en entydig sortering (typisk `.order("id")` til slutt) — ellers
 * kan Postgres stokke like rader forskjellig mellom sidene, og rader dobles eller
 * forsvinner.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PageResult<T>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) return rows
  }
}
