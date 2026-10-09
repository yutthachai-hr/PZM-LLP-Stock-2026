# Upstream verification: Laya, KatGPT-rs, Reflex/Jev, pstack

Checked 7 Oct 2026 through the GitHub API, the Hugging Face API and PyPI.

**Nothing was installed, cloned or downloaded.** The owner gave two lists of sources:
- a chat message: laya.aay.sh, katopz/katgpt-rs, gist-rs/riir-reflexer, backnotprop/pstack and
  flaviocopes.com/pstack;
- the decisions text: Dancing-coin/l-aya, katopz/katgpt-rs, kaustav1996/reflex and chid/pstack.

They disagree on three of the four. This note says what each source actually is.

## Laya

| Source | What it is | Verdict |
|---|---|---|
| **laya.aay.sh** (repo `aayushch/laya`, Apache-2.0) | A desktop app that gathers Gmail, Slack, Jira and similar into one notification feed. **Not the System-1 decision engine.** | **Wrong project. Do not use.** |
| `Dancing-coin/l-aya` (Apache-2.0) | **A fork** of `NandhaKishorM/laya`. GitHub's API says `fork: true`, and the parent is NandhaKishorM. | A mirror. Use the original instead. |
| **`NandhaKishorM/laya`** (Apache-2.0, not a fork, last push 5 Oct 2026) | The original: a multilingual, non-autoregressive System-1 decision engine. Typed questions are `choice`, `score` and `noul` (yes/no/unsure), answered in one forward pass. | **Canonical source.** |
| HF **`convaiinnovations/laya`** | Model card under Apache-2.0. | Pin at sha `7b928d828b7b0e022f929d9bd2e44165aa270148` |
| HF **`convaiinnovations/laya-multilingual`** | mmBERT base, Apache-2.0, with `model.safetensors`, tokenizer and `rl_agent_config.json`. | Pin at sha `1720e3e3357cfe1e281542e223f8273b0890ca34` |
| PyPI **`laya` 0.3.28** | Python ≥ 3.10 and `torch` + `transformers`. The `serve` extra adds FastAPI + uvicorn (a local HTTP service). Also offers `onnx` and `mcp` extras. | The integration path. |

**Fit with the G17 harness.** Laya's `choice` maps to intent, risk, injection, route and
escalation; `noul` maps to the completeness slots. A `LayaClient` adapter would call the local
`serve` endpoint, so the harness needs no change.

**Claims I have not verified.** The README says "33 ms" and "100+ languages". Thai accuracy
is not stated anywhere I checked. Both must be measured on laya-v1 and v2, as G17 requires.

**Dependency cost.** `torch` in a Python service is a new runtime. The CPU-only wheel is
large. The `onnx` extra may allow an onnxruntime-only deployment; measure it.

## KatGPT-rs

| Source | What it is |
|---|---|
| **`katopz/katgpt-rs`** (MIT, Rust, default branch `develop`, pushed 7 Oct 2026) | A neuro-symbolic micro-Transformer research library with many feature flags. It has a boundary contract (`BOUNDARY.md`). The piece relevant to PZM is the opt-in `katgpt-core` **`decision_wire`**: typed `choice` / `score` / `noul` with abstention. |

**Gap.** Nothing in the repo is a ready-made *PZM safety reviewer*. The "stronger safety gate /
adversarial review" role would need a model, genome or rulebook trained or written for PZM
proposals. **The owner should say which checkpoint or artifact is meant**, or confirm that one
has to be built.

## Reflex / Jev: two different projects share the name

| Source | What it is | Fit for PZM |
|---|---|---|
| **`gist-rs/riir-reflexer`** (MIT, Rust) | A decision engine that serves typed decisions over KatGPT-rs `decision_wire`, through JSON lines on stdin/stdout. Today its only genome plays **Tetris**. It needs `../katgpt-rs` beside it as a path dependency. | The *transport* fits our adapter slot (a subprocess with JSON lines, no network). The *engine* knows nothing about PZM. |
| **`kaustav1996/reflex`** (MIT, TypeScript) | A coding agent built on the Pi agent. Its "reflexes" are **TypeSafe Jev**, a **hosted** System-1 model from typesafe.ai. | Every call would send PZM text to an outside service, which is data egress. **Not acceptable by default.** It also needs Node ≥ 22.19 and Pi. |

**The owner should pick one.** The arm D / F / G adapter (`SafetyReviewer`) works with either.

## pstack

| Source | What it is |
|---|---|
| `cursor/plugins` → `pstack/` | **The original** (Lauren Tan / poteto, Cursor). The repo has **no license field on GitHub**: check the folder's own license before vendoring anything. |
| `backnotprop/pstack` (MIT) | A standalone **mirror** of the original, rewritten to work outside Cursor. Installed with `npx skills add backnotprop/pstack`. |
| `chid/pstack` (MIT) → installs from `michael-denyer/pstack-claude` (MIT) | A **port** to Claude Code. Its README installs from michael-denyer's marketplace, not from chid. Synced to upstream `e8d856f`. |
| flaviocopes.com/pstack | An article, not a source. |

**Recommendation.** pstack is a set of agent skills, not a runtime dependency. The safest path:
1. read the original folder's licence in `cursor/plugins`;
2. if the owner wants it in Claude Code, install `michael-denyer/pstack-claude` pinned to a
   commit SHA;
3. keep `npm run verify` as the gate pstack calls (`docs/engineering/pstack-workflow.md`).

pstack's installer adds a `SessionStart` hook that routes tasks automatically. That changes
agent behaviour, so it is the owner's call.

## What changes in the plan

- **G17 Laya adapter:** target `NandhaKishorM/laya` with PyPI `laya==0.3.28` `[serve]`, the
  HF checkpoints pinned at the SHAs above, and a local HTTP service. Installing it needs the
  owner's go-ahead, because it adds Python and torch to this machine.
- **Kat and Reflex adapters:** stay NOT_RUN until the owner names the artifact. Neither upstream
  ships a PZM-ready reviewer.
- **pstack:** waits on the licence check and the owner's choice of distribution.
