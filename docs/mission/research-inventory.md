# Existing research evidence (checked 15 Oct 2026, 07:00Z)

Do not rebuild these. New work is only what the last column says.

| Topic | Where | Verdict on record | Still open |
|---|---|---|---|
| Goose | origin/exp/real-stack `docs/research/goose-adoption-decision.md`, `goose-benchmark.md`, `research/goose/` | RESEARCH ONLY. Correct (0 disagreements over 3 x 1,105 cases); 1.8-1.9x faster check up to 250k movements, but slowest end to end after the TS-to-flat conversion; cannot run on Cloudflare Workers or Pages; upstream 6 weeks old | A matching-kernel comparison only if a measured matching bottleneck exists. None measured yet |
| Reflexer (`gist-rs/riir-reflexer`) | origin/exp/real-stack `docs/agent-safety/02-upstream-verification.md` | Transport (typed decisions over JSON lines, subprocess, no network) fits the SafetyReviewer adapter slot; engine is Tetris-only and knows nothing about PZM | Typed decision record for matching (MATCH_EXACT ... ABSTAIN) can reuse the protocol shape without the engine |
| Rust integrity | `crates/pzm-integrity` on research/20261014-local-tech b3d34dc and exp/real-stack; 58 golden vectors, property and malicious suites | Parity with the TS reference; a NaN `per` bug was found and fixed through the Goose work | main CI `rust` job is a placeholder that fails if the crate appears; bringing the crate to main needs the RC rust job |
| Laya / Laya Multilingual | exp/real-stack `stack/evidence/laya-heldout.json`, `docs/release/go-no-go-ask-pzm-staging.md` | Staging GO for the deterministic read-only contract, model routing NO-GO; laya-v1 no longer independent | Blind held-out set (brief `review-briefs/c-heldout-blind.md`); staff-written 50-100 questions remain the real gate |
| ThaiTrees lexicon | worktree pzm-mission-thaitrees-20261014 (clean) | Not started; queued child ses ...IGWpEsbg in cooldown | Lexicon-only offline eval |
