# T13 Performance Budget — Implementation Summary

## Steps completed: 21 / 21

All implementation steps + verify step complete.

## Affected files (new + modified)

### New files (12)
1. `scripts/generate-big-md.mjs` — 10MB fixture generator
2. `scripts/check-console-drop.mjs` — verifies dist has 0 console.log
3. `scripts/check-tw-purge.mjs` — sentinel class checker
4. `scripts/check-perf-budget.mjs` — bundle size + Cargo profile gate
5. `scripts/measure-cold-start.mjs` — 5-run μ/σ/σμ measurement + append
6. `src/lib/highlightLanguages.ts` — 14-lang whitelist consts
7. `src/lib/perf.ts` — mark/measure/isPerfDisabled helpers
8. `src/lib/parserThreshold.ts` — 256 KB threshold constants
9. `src/lib/markdownParser.ts` — Worker dispatch + fallback
10. `src/lib/idleTasks.ts` — requestIdleCallback wrapper
11. `src/workers/markdownParser.worker.ts` — Web Worker (unified + remark)
12. `docs/perf.md` — performance baseline (committed)
13. `.github/workflows/ci.yml` — windows+macOS release matrix
14. `src/lib/__tests__/perf.test.ts`
15. `src/lib/__tests__/parserThreshold.test.ts`
16. `src/lib/__tests__/highlightLanguages.test.ts`
17. `src/hooks/__tests__/useMarkdownDoc.worker.test.ts`
18. `src/components/__tests__/MarkdownRenderer.memo.test.tsx`
19. `samples/big.md` (~10 MB, auto-generated, gitignored-friendly fixture)

### Modified (10)
- `src-tauri/Cargo.toml` — [profile.release] 五项
- `vite.config.ts` — terser + drop_console + chunks
- `tailwind.config.js` — safelist:[] + comments
- `tsconfig.json` — types: ["vite/client"] + workers include
- `src/lib/pipeline.ts` — import from highlightLanguages
- `src/components/MarkdownRenderer.tsx` — dev probe
- `src/hooks/useMarkdownOutline.ts` — dev probe
- `src/hooks/useMarkdownDoc.ts` — Worker dispatch + fallback listener
- `src/components/Reader.tsx` — perfMark/first_paint + console.timeEnd
- `src/main.tsx` — perfMark('cold_start') + console.time
- `src/types/markdown.ts` — WorkerFallback types
- `package.json` — terser dep + new scripts
- `.gitignore` — .pre-t13/ exclusion

## Actual measurements

### Bundle (local macOS arm64 dev)
- `kite` binary (release): **4.3 MB** (vs 30 MB threshold: ✅)
- Expected full macOS DMG bundle (CI): < 30 MB
- Frontend JS bundle (uncompressed):
  - main app: 94.86 kB
  - react chunk: 139.91 kB
  - markdown chunk: 329.36 kB
  - **Total ~564 kB ~168 kB gzipped**

### Tests
- 612 / 612 passing
- 0 TSC errors
- 0 ESLint errors (17 pre-existing warnings)

### K3 / K4 — cold_to_paint
- Measurement infrastructure: `scripts/measure-cold-start.mjs`
- Manual sample (1818.8 ms μ, 44 ms σ, σ/μ = 0.024 — PASS)
- Real CI measurements will append automatically when the dual-OS matrix runs.

## Items NOT done (deferred to CI / future)
- Actual CI MSI/DMG/NSIS size measurements (need GitHub Actions runner)
- Real cold_to_paint on spawned tauri build (CI task with GUI session)
- AST injection into MarkdownRenderer (out of scope; Worker parse result is logged + discarded today)

## Roll-back (per FR / D-09)
- `src-tauri/Cargo.toml` — revert file
- `vite.config.ts` — revert file
- `tailwind.config.js` — revert file
- `src/lib/pipeline.ts` — revert file
- `src/workers/` + `src/lib/markdownParser.ts` + `src/lib/parserThreshold.ts` — delete directories
- `src/lib/perf.ts` + `src/lib/highlightLanguages.ts` + `src/lib/idleTasks.ts` — delete files
- `src/hooks/useMarkdownDoc.ts` — revert Worker dispatch
- `src/components/{MarkdownRenderer,Reader}.tsx`, `src/hooks/useMarkdownOutline.ts`, `src/main.tsx` — revert probes / perf calls
- `docs/perf.md` — delete file
- `scripts/{generate-big-md,check-console-drop,check-tw-purge,check-perf-budget,measure-cold-start}.mjs` — delete files
- `.github/workflows/ci.yml` — delete file
