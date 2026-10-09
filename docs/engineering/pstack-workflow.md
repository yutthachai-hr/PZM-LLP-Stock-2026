# Engineering workflow (G14)

**pstack is not in this repo or on any machine used so far.** This page writes down the
workflow pstack is meant to drive, and automates every gate that is purely mechanical, so the
tool can be attached later without changing what "done" means. When the owner supplies pstack
(binary, skill or source), wire it to call `npm run verify` and the steps below. Do not
re-implement it from guesses.

## The loop for each phase

1. **Plan.** The work is written in `docs/PLAN-operations-os.md` or a design note
   (for G11–G16: `docs/agent-safety/00-inspection-and-design.md`). It has an exit gate that
   someone else can check.
2. **Inspect before changing.** Read the real code and say what exists. G11 started with a
   16-point inspection because the brief assumed components (KatGPT, Reflex, pstack, Rust)
   that were not there.
3. **Test first where the rule is new.** For example, a guard rule gets its failing test on
   both sides (PASS and DENY) before the rule exists.
4. **Implement**, keeping the boundaries:
   - `src/agent/**` and `src/intel/**` are pure. `tests/agent-no-write-path.test.ts` and
     `tests/suggest-only.test.ts` fail the build otherwise.
   - Nothing proposes, approves or executes on its own. Executing anything is Phase H and
     needs the owner's approval.
5. **Gate:** run `npm run verify` and get it green. Then run the emulator gates for
   anything touching rules or screens.
6. **Evidence:** write `docs/evidence/<phase>.md` with the numbers, the commands that
   produced them, and what was *not* done or not measurable.
7. **Hand off:** update `HANDOFF.md` §14 with status per step, commit and push the branch.
   Never merge or deploy without the owner.

## `npm run verify`

| Gate | Command | Fails when |
|---|---|---|
| Types (app, functions, worker, e2e) | `tsc -p … --noEmit` | any type error |
| Lint | `oxlint` | any lint error |
| Unit tests | `vitest run` | any failure, including the purity gates |
| i18n | `npm run i18n:check` | Thai UI copy that never reaches `t()` |
| Safety dataset fresh | `npm run safety:dataset -- --check` | `datasets/agent-safety/v1` differs from a fresh seeded build |
| Integrity vectors fresh | `npm run integrity:vectors -- --check` | `crates/pzm-integrity/vectors` differs from the TS reference |
| Safety bench | `npm run safety:bench -- --no-write` | any UNSAFE row allowed, or any row errors (run without `--no-write` to refresh the evidence file) |
| Rust | `cargo test --release` in `crates/pzm-integrity` | any vector differs; **SKIPPED** (never counted as a pass) when cargo is absent |
| `--full` only | `npm run build`, `npm run check:bundle` | build error, bundle over budget |

**Not run by `verify`, because they need the Firebase emulator:** `npm run test:rules`,
`npm run test:e2e`, and the flaky-run loop (see `docs/evidence/release-gate.md` for how they
are run in the cloud container).

## Rust on Windows

`rustup` installs the MSVC toolchain by default, which needs Visual Studio Build Tools for
its linker. On a machine without them, the GNU toolchain works. Set it for this crate only,
outside the repo:

```bash
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
cd crates/pzm-integrity && rustup override set stable-x86_64-pc-windows-gnu
```

Nothing in the repo pins a toolchain, so Linux CI uses its default.

## Rules that stay true however the tooling changes

- AI never writes the database. A proposal is data, and the deterministic guard is the floor.
- A dataset or vector file changes only by regenerating it. Hand edits fail the freshness gates.
- A gate that could not run is reported as SKIPPED with the reason, never as PASS.
- The H phases (H1–H10) start only with the owner's approval.
