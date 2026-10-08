# R&D: Goose benchmark: TypeScript vs Rust vs Goose on `pzm-integrity/1`

**Run:** 8 Oct 2026, one machine (Windows 11, Node 24.18, Rust stable, clang 23.1.3 from
llvm-mingw 20261006). Goose is pinned at `9ddd83c`.

**Inputs:** identical for all three. `largeSnapshot(n)` from `src/agent/integrityVectors.ts`
(the generator the existing G13 benchmark uses); JSON for TS and Rust, and the same snapshot
as `pzm-integrity-flat/1` for Goose.

No Firestore and no network were involved. Raw data is in `docs/research/data/`.

## 1. Correctness first: the three-way differential

`node research/goose/harness.mjs diff --n 1000 --seed S`

**The reference:**
- for each golden vector, its committed report (what `cargo test` checks);
- for all other cases, the TS reference run on the original object.

**The cases:**
- 58 golden vectors (all of `crates/pzm-integrity/vectors`);
- the hand cases (empty, rounding, Bangkok month boundaries, period locks, conversions,
  orphans, duplicate operations, transit);
- 13 adversarial cases aimed at a third implementation:
  - key collisions (`a__b` + `c` versus `a` + `b__c`);
  - a `/` inside a transfer id;
  - an empty versus an absent `poId`;
  - duplicate level, transfer and closed-period ids (the last one wins);
  - a whitespace-only lock override;
  - `"`, `\`, tab, newline and NUL inside ids;
  - Thai and mixed-case units;
  - empty-string locations;
  - a NaN `per`;
  - rounding boundaries (0.0005, 2.675, 0.1 + 0.2 …);
  - a three-way concurrent operation id;
- 1,000 random worlds per seed.

| Seed | Cases | Findings compared | Reference ≠ Rust | Reference ≠ Goose |
|---|---|---|---|---|
| 42 | 1,105 | 28,273 | **0** | **0** |
| 7 | 1,105 | 27,955 | **0** | **0** |
| 2026 | 1,105 | 28,208 | **0** | **0** |

Every size of the performance runs below also produced **byte-identical reports** from all
three (`sameReport`).

### The third implementation found a real bug in the existing Rust engine

- **The case:** a conversion with a NaN `per` (JSON `null`). The reference and Goose both
  report `INV.UNIT_CONVERSION_VALID` ("2/NaN").
- **What Rust did:** it read `per: null` as **absent**, so it returned PASS. It already read
  `size: null` as NaN; `per` lacked the same treatment.
- **Fixed in this batch:** `nan_if_null_opt` in `crates/pzm-integrity/src/lib.rs`.
- **New golden vector:** `017-bad-conversion-per-nan`. It fails against the old Rust (this
  was checked) and passes now.
- The existing TS ↔ Rust differential had not covered a NaN `per`.

### Refusal instead of a wrong answer

A snapshot outside the flat contract makes Goose refuse with
`{"error":"input outside pzm-integrity-flat/1"}`. The example tested was a quantity of
2·10¹³, which TS prints as `20000000000000`. Goose never prints an approximated number.

## 2. Performance

**What each column measures:**
- **In-process:** the check alone, repeated in one process. TS uses
  `performance.now()` around `checkIntegrity`; Rust and Goose use their own `--bench`.
- **Process:** the whole CLI, from spawn to exit; for Rust that includes reading and parsing
  the JSON.
- **Peak:** the peak working set of the CLI process, sampled every 2 ms. At 1k movements
  the process exits before a sample is taken.

| Movements | TS parse | TS check p50 / p95 | Rust check p50 / p95 | Goose check p50 / p95 | Rust process | Goose process | Rust peak | Goose peak |
|---|---|---|---|---|---|---|---|---|
| 1,000 | 1.9 ms | 2.8 / 4.9 ms | 3.2 / 3.6 ms | **1.7 / 2.2 ms** | 18 ms | 15 ms | — | — |
| 10,000 | 10 ms | 16.0 / 27.8 ms | 15.6 / 16.2 ms | **8.5 / 9.3 ms** | 40 ms | 25 ms | 13.8 MB | **9.3 MB** |
| 60,000 | 57 ms | 86.9 / 125.0 ms | 79.2 / 100.0 ms | **42.5 / 57.3 ms** | 155 ms | 76 ms | 49.2 MB | **28.3 MB** |
| 250,000 | 226 ms | 397.7 / 461.3 ms | 330.8 / 341.8 ms | **187.1 / 197.5 ms** | 564 ms | 328 ms | 178 MB | **108 MB** |
| 1,000,000 | 1,821 ms | 2,222 / 2,244 ms | 2,052 / 2,584 ms | **1,701 / 1,928 ms** | 4,446 ms | 2,127 ms | 687 MB | **396 MB** |

**CPU time of the CLI process** (Windows `TotalProcessorTime`):

| Movements | Rust | Goose |
|---|---|---|
| 10k | 31 ms | 16 ms |
| 60k | 125 ms | 94 ms |
| 250k | 531 ms | 234 ms |
| 1M | 4,063 ms | 1,406 ms |

### The integration overhead

Goose reads the flat contract, which **TypeScript must produce from the JSON** (`flat.ts`):

| Movements | Flatten in TS | Goose end to end (flatten + process) | Rust end to end (process) | TS end to end (parse + check) |
|---|---|---|---|---|
| 1,000 | 11 ms | 26 ms | 18 ms | 4.7 ms |
| 60,000 | 235 ms | 311 ms | 155 ms | 144 ms |
| 250,000 | 923 ms | 1,251 ms | 564 ms | 624 ms |
| 1,000,000 | 6,457 ms | 8,584 ms | 4,446 ms | 4,043 ms |

**With the conversion counted, Goose is the slowest of the three at every size.** The
conversion could be avoided only by a second exporter that writes the flat form directly. That
is a new producer to build, test and keep in step with the JSON one.

### Build and size

| Item | Goose | Rust |
|---|---|---|
| Compiler build (Goose, from source; clean) | **62 s** (configure 4 s + build 58 s, 12 threads, clang 23) | rustup toolchain (prebuilt) |
| Source → C | 0.43 s | — |
| C → executable (`clang -O2`, standalone runtime) | 4.3 s | `cargo build --release`, incremental |
| Generated C | 700 KB | — |
| Executable | **186 KB** | 788 KB |
| Source lines (same ten invariants) | 618 (+ 7 C, + 75 TS contract) | 535 |
| Toolchain on this machine | CMake + llvm-mingw + Ninja, about 250 MB portable | rustup |

## 3. What this means at PZM's size

- **The largest real brand is 3,173 movements.** At that size every engine's check takes
  **under 10 ms**, and each CLI under 30 ms.
- **The only consumer is offline:** the integrity auditor and the differential gate. No user
  waits on it.
- **A 2× gain on 5 ms is not a material benefit.** The memory advantage (about 40% less) only
  shows above about 60k movements, which is about 20× PZM's current data.

The decision is in `goose-adoption-decision.md`.
