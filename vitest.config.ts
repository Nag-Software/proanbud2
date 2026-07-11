import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Stale agent-worktrees under .claude/worktrees/ contain full repo copies —
    // without this exclude every test file runs 2-4× and their failures drown
    // out the real suite. tests/e2e/ er Playwright, ikke vitest.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/tests/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
