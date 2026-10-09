# R&D: Goose (aardappel/goose) feasibility for PZM

Research track opened by the owner, 8 Oct 2026. **Research only. Nothing here is on an app
path, deployed, or connected to any database.**

This is the Goose **programming language** by Wouter van Oortmerssen (aardappel). It is not
Block's Goose AI agent.

## 1. Upstream, pinned

| Item | Value |
|---|---|
| Repository | https://github.com/aardappel/goose |
| Pinned revision | **`9ddd83ce45816dd95d624c3f5a35fb50167f1d6d`** (master, 2026-10-05, "Reduce typechecker stack usage for deep call chains") |
| Licence | **Apache-2.0** (`LICENSE`). Compatible with PZM; attribution only if redistributed. |
| Age / activity | **First commit 2026-08-27, so about 6 weeks old.** 513 commits; 5 forks, about 200 stars. `bench/adoption.md` says compiler changes were developed "each by its own agent". |
| Tests | 2,062 `.goose` test programs (`test/`); CI on Ubuntu, macOS and Windows; ASan + UBSan profile on Linux |
| Submodules | TinyCC (JIT backend), SDL3, Box3D, Nuklear. **All optional**; not fetched for this study. |

The clone lives **outside the repository and OneDrive**, in `C:\pzm-research\goose`. It is
checked out at the pinned SHA, and `harness.mjs build` refuses any other revision.

## 2. Toolchain (isolated, portable, checksum-verified)

The owner approved the portable option on 8 Oct. The tools were extracted to
`C:\pzm-research\tools`, with no installer and no PATH or registry changes. Deleting the
folder removes them.

| Tool | Version | Source | SHA-256 (verified against the release's published digest) |
|---|---|---|---|
| CMake | 4.4.4 | github.com/Kitware/CMake releases | `bace36e94b31c68ab6fa295f26dfa11219e0701cf7c94b0284a7d1cb13dac536` |
| llvm-mingw (clang, C++20, UCRT) | 20261006 | github.com/mstorsjo/llvm-mingw releases | `317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a` |
| Ninja | 1.13.2 | github.com/ninja-build/ninja releases | `07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65` |

**Upstream requirements:**
- CMake ≥ 3.20 and a C++20 compiler for the Goose compiler.
- The generated code is plain C99 (plus `#pragma pack`), built with any C compiler.
- Upstream CI uses MSVC and clang on Windows, gcc and clang on Linux, and Apple clang on macOS.
- The `MINGW` branch exists in `CMakeLists.txt`, so llvm-mingw is a supported shape, not a hack.

## 3. How Goose works (what matters for PZM)

- **Compiles to one C file** (`goose -o x.c x.goose`), then any C compiler builds it. There
  is also an in-process TinyCC JIT (optional, not used here).
- **Memory:** no heap, no GC. A few compiler-assigned **data stacks**, each a large
  address-space reservation committed on touch behind guard pages (`VirtualAlloc` /
  `mmap`). Scope exit frees.
- **Interop:**
  - `extern fn` calls C directly: scalars, flat structs, slices, string builders.
  - Goose functions can be exported to C (tutorial §19).
  - There are **no subprocesses or networking** in the library.
- **Data representation:**
  - variable-size data is stored inline (no pointers);
  - **arrays of variable-size elements cannot be indexed**;
  - one resizable per struct;
  - no closures that escape;
  - whole-program compilation only.
- **Standard library:** strings, dictionary, sort, files, stdin/stdout, a clock. **No JSON
  reader** (a sample parser only, `samples/18_json.goose`).
- **WebAssembly: not supported.**
  - The spec lists a "Wasm fallback" as **future work** (§10.4, open item 15).
  - The runtime needs address-space reservation and a fault handler.
  - So Goose **cannot run inside Cloudflare Workers or Pages Functions**, whose only native
    format is WASM, and generated C cannot execute there either.

## 4. PZM: what exists, and which CPU-bound work could justify a third engine

| Component | Where | Work per run at PZM's size |
|---|---|---|
| Integrity invariants (TS reference) | `src/agent/integrityReference.ts`, `pzm-integrity/1` | Ten invariants. **Largest brand backup: 3,173 movements, 336 products** (Pizza Mania, 6 Oct). |
| Integrity engine (Rust) | `crates/pzm-integrity` (serde only), `--batch`, `--bench` | 57 golden vectors; property tests at 10k; TS ↔ Rust differential in `verify` |
| Integrity Auditor (backups) | `scripts/integrity-audit.mjs` → app auditor | Offline, on backup files |
| Supplier / inventory intelligence | `src/intel/*` (stock-out, delivery risk, transfer suggestions) | Per screen, over cached data; measured in milliseconds |
| Simulation / backtest | `scripts/intel-backtest.mjs` | Offline |
| Supabase shadow parity | `src/shadow/parity.ts` (SQL does the heavy lifting) | Seconds, offline |
| Cloud runtime | Cloudflare Pages Functions / Worker cron | **JS/WASM only** |

Existing measurement (`docs/evidence/data/integrity-bench.json`, 60k movements): **TS warm
p50 ≈ 102 ms, Rust ≈ 111 ms**, Rust CLI cold ≈ 176 ms, peak ≈ 42 MB. Rust was not faster; its
value is independence. At PZM's real size (about 3k movements) every engine finishes in a
few milliseconds.

**Conclusion of the inspection:** no PZM workload is CPU-bound today. The only candidate
for a third engine is the same one Rust already covers: offline ledger integrity over
exported snapshots. That is why the prototype is **a third implementation of `pzm-integrity/1`**
rather than a new component. It reuses the vectors and the differential, and invents no new
accounting rule.

## 5. The prototype (`research/goose/`)

| File | What |
|---|---|
| `integrity.goose` | The ten invariants, ported line by line from the reference (each block cites the reference lines) |
| `bits.h` | Three C helpers bound with `extern fn`: IEEE-754 bits to double (`memcpy`), `floor`, `isfinite` |
| `flat.ts` | The input contract `pzm-integrity-flat/1` (TS; research only) |
| `harness.mjs` | `build` (pinned compiler → C → exe), `diff` (TS vs Rust vs Goose), `bench` |

**Why a flat contract instead of JSON.** Goose has no JSON reader, and writing one would be
more Goose code than the check itself. `pzm-integrity-flat/1`:
- carries numbers as their **exact IEEE-754 bits**, so no decimal parsing can differ from
  JavaScript's;
- keeps absent optional strings apart from empty ones (the reference tells them apart);
- escapes text.

The conversion is done in TypeScript and **counted as integration overhead** in the
benchmark. JSON validation therefore stays in TS, which narrows Goose's independence:
recorded in §7.

## 6. Safety

- Goose here reads **only** exported or synthetic snapshots on stdin and writes a report on
  stdout.
- It has no network library, no database client and no credentials.
- It is not imported by the app, the functions or the Worker.
- **No feature flag was needed**, because no application adapter exists.
- It cannot write Firestore or Supabase, change balances, override the Business Guard or
  period locks, approve, transfer or receive, or replace the Rust validation.
- Core PZM is unchanged and does not know Goose exists.

## 7. Known limitations of the prototype (it refuses rather than guesses)

1. **Number printing.** `String(round3(x))` is reproduced exactly for |x| < 1e12, and for
   integral times and counts below 2^53. Outside that range the snapshot is **refused**.
   Rust prints such huge values differently from JS too; the vectors contain none.
2. **Unit labels:** trim and lowercase are **ASCII-only**. JS and Rust lowercase every cased
   letter and trim Unicode spaces. Thai has no case, so Thai and ASCII units match; a label
   like `Ü`-something or with NBSP padding would not.
3. **Sort order:** bytewise (UTF-8), the same as Rust. JS sorts by UTF-16 code unit, which
   differs only between astral characters and U+E000–U+FFFF.
4. JSON validation is the TS converter's job, not Goose's (see §5).

Results, timings and the decision are in `goose-benchmark.md` and
`goose-adoption-decision.md`.
