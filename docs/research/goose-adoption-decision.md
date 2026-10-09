# R&D: Goose adoption decision

## Decision: **RESEARCH ONLY**

Goose is **not** adopted for production or for offline processing. The prototype stays in
`research/goose/`, unbuilt by any PZM gate, as evidence and as a third-implementation check
that can be re-run by hand.

## Against the owner's promotion criteria

| Criterion | Result |
|---|---|
| Correctness matches the reference | **Met.** 0 disagreements over 3 × 1,105 cases (about 84k findings) and every benchmark size, including 58 golden vectors and 13 adversarial cases (`goose-benchmark.md` §1) |
| No unsupported input classes remain | **Not met.** Refused, not mis-computed: numbers ≥ 10¹² (and non-integral times); ASCII-only lowercase and trim for unit labels; JSON input (only the flat contract) |
| Performance or memory gains materially useful | **Not met.** Check alone: about 1.8–1.9× faster up to 250k movements, 17–23% at 1M; 40–42% less peak memory. But PZM's largest brand is 3,173 movements, where every engine takes under 10 ms, offline. |
| Integration overhead does not erase the gain | **Not met.** The TS → flat conversion makes Goose **the slowest of the three end to end** at every size (250k: 1.25 s vs Rust 0.56 s, TS 0.62 s) |
| Toolchain and deployment reproducible | **Partly.** Pinned SHA, checksum-verified portable tools, and a scripted build. But it needs CMake + C++20 + a C compiler (about 250 MB) beside Node and Rust. **It cannot run in Cloudflare Workers or Pages** (no WASM; the runtime needs address-space reservation). |
| CI can build and verify it | **Possible, not done.** It would add a clean compiler build (62 s on 12 threads here) plus toolchain setup to every CI run, for a component no user path uses |
| Operational complexity reasonable | **Not met.** A third language and toolchain for the same ten invariants already covered twice (TS reference + Rust) |
| Maintenance risks documented | **Done, and high.** Upstream is **6 weeks old** (first commit 27 Aug 2026); its compiler changes were developed by agents (`bench/adoption.md`); there is one maintainer; the C runtime ABI changes between versions (`GS_RUNTIME_VERSION`); memory safety rests on a young compiler's analysis |

The owner's threshold was "at least 25% meaningful processing improvement OR 30% peak
memory reduction on a **representative bottleneck**, with no correctness regression":
- The memory reduction (40%+) and the speed-up (up to about 1.9×) **exist**.
- But **there is no representative bottleneck.** The workload is offline, takes milliseconds
  at PZM's size, and nobody waits on it.
- End to end, the integration cost turns the speed-up into a loss.

## What the research did produce (kept)

1. **A real bug fixed in the existing Rust engine.** A NaN `per` (JSON `null`) was read as
   absent and passed. It is now refused as the reference does, guarded by golden vector
   `017-bad-conversion-per-nan` (`goose-benchmark.md` §1).
2. **13 adversarial cases** for any implementation of `pzm-integrity/1`. They live in
   `research/goose/harness.mjs` (`extraCases`) and could be promoted into the golden vectors.
3. **A measured scaling profile of the TS and Rust engines up to 1M movements.** Neither is
   a risk at 300× PZM's current size.

## When to look again

Re-open only if **all** of these hold:
- a PZM workload becomes CPU- or memory-bound **offline**, for example multi-year,
  multi-brand reprocessing of more than 1M movements on a memory-limited machine;
- a flat or binary export exists anyway, for another reason (so there is no conversion cost);
- upstream has a stable release with a versioned runtime ABI and more than one maintainer.

Goose would still never run inside Cloudflare unless upstream ships its planned WASM
fallback.

## Cost and rollback

- **Cost so far:** `C:\pzm-research` (about 1.5 GB: tools, clone, builds, benchmark inputs) plus research files
  in the repo.
- **Rollback:**
  - delete `C:\pzm-research`;
  - delete `research/goose/` and `docs/research/`.

  Nothing in the app, the functions, the Worker, CI or `verify` depends on any of them.
- **Kept:** the Rust fix and its vector. They stand on their own.
