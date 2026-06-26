// Pure, dependency-free helpers safe to import from client components. The server
// implementation (generateProjectSummary) lives in project-summary.ts and pulls in
// server-only modules (OpenAI, error logger), so keep these split out to avoid
// dragging server-only code into client bundles.

export function readProjectSummaryFromAnalysis(analysisResult: unknown) {
  if (!analysisResult || typeof analysisResult !== "object") return ""

  const summary = (analysisResult as Record<string, unknown>).summary
  return typeof summary === "string" ? summary.trim() : ""
}

export function mergeAnalysisSummary(analysisResult: unknown, summary: string) {
  const base =
    analysisResult && typeof analysisResult === "object" ? { ...(analysisResult as Record<string, unknown>) } : {}
  return {
    ...base,
    summary,
    generatedAt: new Date().toISOString(),
  }
}
