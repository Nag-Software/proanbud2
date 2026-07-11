import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Stale agent-worktrees inneholder fulle repo-kopier (samme grunn som
    // vitest-excluden) — uten denne drukner reelle funn i 2000+ falske.
    ".claude/**",
    // Playwright-artefakter:
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
