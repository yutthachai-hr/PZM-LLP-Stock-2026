# Separate bundle-budget diagnosis

## Claim to check

The unchanged main application at `af0136b0f6886989bc32d651a384ac05b39cdad6` exceeds the strict RC artifact-size targets because its initial bundle includes eager routes and export dependencies. Main's configured CI no-regression budget is a different check. Passing it does not satisfy the RC target. No threshold change or measured runtime speedup is proposed.

## Method

Read `scripts/bundle-budget.mjs` and `.github/workflows/ci.yml`. Inventory the actual initial JS files linked from built `dist/index.html`, recording exact bytes and SHA-256 hashes. Run the original budget script once with default 900/2048 KB targets and once with the checked-in main CI 2950/3450 KB targets against the identical artifact. Attribute dependency reachability from source imports, not guesses about compressed sizes.

This is static artifact accounting, not a latency benchmark. One artifact inventory is sufficient to decide whether those exact bytes exceed a fixed limit. No performance win or choice between implementations will be inferred from it. PR #16 remains a separate final-SHA evaluation with functional lazy-route, export and PWA gates.

## Evidence

Fresh inventory is `bundle-artifact-inventory.json`. The original preflight receipts remain untouched.

- Initial main file is exactly 3,001,464 bytes. All four JS files linked from `dist/index.html` total 3,528,348 bytes. SHA-256 hashes are in the inventory.
- Default strict check returned exit 1. Main exceeds 900 KiB by 2,079,864 bytes. The initial total exceeds 2048 KiB by 1,431,196 bytes.
- The same artifact with the checked-in main CI limits returned exit 0. Remaining headroom is 19,336 bytes for main and only 4,452 bytes for the initial total. No limit or script was changed.
- `src/App.tsx:17-29` eagerly imports Products, StockCard, Reports and Orders. Products and StockCard statically import `src/lib/export.ts`; `src/lib/requestExport.ts` also imports it statically. `src/lib/export.ts:1-4` statically imports xlsx, jsPDF, AutoTable and the Thai font. A dynamic import in another caller cannot remove that already-eager graph from initial loading.
- The font's base64 source string is 120,296 bytes. That is a source-string size, not an attributed minified-byte count. It does not explain the whole oversized entry. No per-package compressed size or page-load speed claim is made.

## Decision and next gate

Keep the strict failure open as the code-splitting target. Keep the main no-regression check at its existing values. PR #16 at `fe989690e74f549cd6fdd4529c3d7e3b2350f665` is the existing candidate, not a reason to rebuild its implementation. Its E2E, offline/PWA and Excel/PDF behavior, final SHA review and Preview QA must be verified separately before any merge.

Benchmark-checklist was loaded from `C:/Users/Yutthachai/.agents/skills/benchmark-checklist/SKILL.md`. The claim is fixed-byte artifact accounting, not runtime performance. Error exits were counted, actual linked files were read, the same files were used for both checks, and hashes make the observation reproducible. CPU timing, five alternating latency samples and production throughput are intentionally not claimed or used to select a winner.
