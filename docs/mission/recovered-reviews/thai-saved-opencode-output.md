# Recovered OpenCode output (not a new review)

ThaiTrees stream B complete. Work committed scoped worktree `C:/Users/Yutthachai/pzm-mission-thaitrees-20261014` branch `research/20261014-thaitrees`.

Baseline SHA: `af0136b0f6886989bc32d651a384ac05b39cdad6`  
Final SHA: `c0d137bcf92a4f000626886e999df5e3b4af01fe`  
Merge: None (awaiting parent review assignment).

---

### Native Skill Workflow Evidence

| Skill | Path Loaded | Executed | Skipped & Reason | Evidence |
|---|---|---|---|---|
| `brainstorming` | `C:\Users\Yutthachai\.cache\opencode\npm\git-superpowers-0958a5557860\1792030689046\node_modules\superpowers\skills\brainstorming\SKILL.md` (YES) | Architecture scope check, trade-off bounding | User conversation loops (authorized autonomous execution) | `docs/mission/thaitrees/decisions.tsv` |
| `writing-plans` | `C:\Users\Yutthachai\.cache\opencode\npm\git-superpowers-0958a5557860\1792030689046\node_modules\superpowers\skills\writing-plans\SKILL.md` (YES) | 4-task implementation plan with checkboxes, review focus, interfaces | Subagent delegation (standing orders #1 mandate native inline execution) | `docs/mission/thaitrees/experiment-plan.md` |
| `test-driven-development` | `C:\Users\Yutthachai\.cache\opencode\npm\git-superpowers-0958a5557860\1792030689046\node_modules\superpowers\skills\test-driven-development\SKILL.md` (YES) | Red test failure verified, minimal code green, refactor | None | RED on missing module + token split, then GREEN 5/5 |
| `verification-before-completion` | `C:\Users\Yutthachai\.cache\opencode\npm\git-superpowers-0958a5557860\1792030689046\node_modules\superpowers\skills\verification-before-completion\SKILL.md` (YES) | Ran fresh full commands, checked exits, 0 claims without evidence | None | `vitest` 5/5 pass, existing 26/26 pass, `oxlint` 0 warnings |
| `systematic-debugging` | `C:\Users\Yutthachai\.cache\opencode\npm\git-superpowers-0958a5557860\1792030689046\node_modules\superpowers\skills\systematic-debugging\SKILL.md` (YES) | Diagnosed compound match failure in `evaluator.ts` | None | Traced token group matching vs catalog categories |
| `benchmark-checklist` | `C:\Users\Yutthachai\.agents\skills\benchmark-checklist\SKILL.md` (YES) | 7 questions answered, 5 interleaved runs per side, limiter named | None | `research/thaitrees/run-benchmark.ts` |

---

### Upstream Sources & Provenance

1. **GitHub**: `https://github.com/nlp-chula/thaitrees`  
   - Commit: `6560423887edb8c5a2d24af19d88bf7f61c440cb` (24 Sep 2026)  
   - Authors: Attapol T. Rutherford & Papatchol Thientong (Chulalongkorn University)  
   - Scope: 341,967,133 tokens across 366,120 docs (News, Wikipedia, Spoken, Social media)
2. **Hugging Face**: `https://huggingface.co/datasets/nlp-chula/ThaiTrees`  
   - Revision SHA: `60f7e90cfb3254678f6967163f727770224a632d`  
   - License: CC BY-SA 4.0 (`cc-by-sa-4.0`)  
   - Size: 6.12 GB (raw, parsed CoNLL-U, lexicon parquet/sqlite)  
   - Lexicon schema: 451,252 rows, 34 columns
3. **Paper**: `https://arxiv.org/abs/2609.27558` (arXiv:2609.27558, 23 Sep 2026)

### Legal Boundaries & Governance

- License: CC BY-SA 4.0.
- ShareAlike constraint: No full corpus, CoNLL-U trees, or weights added to repo.
- Artifact: Scoped culinary subset `research/thaitrees/lexicon-subset.json` under `research/thaitrees/LICENSE`. Zero customer data.
- Epistemic boundary: ThaiTrees is unvalidated linguistic input, not inventory truth. SKU > confirmed alias > exact name > ambiguous supplier candidates > linguistic suggestion.

---

### Comparative Benchmark Results

*Interleaved 5 runs on Node.js v24.18.0; 35 frozen cases; 25 catalog items; limiter: V8 string matching on single core.*

| Method | Accuracy | Passed / 35 | Median Latency | Range | Verdict |
|---|---|---|---|---|---|
| **Baseline A (Status Quo)** | 42.9% | 15 | 98.40 µs | 0.60 µs – 839.10 µs | Confirms UX-0001: Thai searches fail 100% |
| **Lexicon B (Unsegmented)** | 68.6% | 24 | 99.00 µs | 0.80 µs – 275.70 µs | Resolves single Thai words; fails compounds |
| **Segmentation C (AttaCut/Greedy)** | 80.0% | 28 | 165.00 µs | 0.90 µs – 462.00 µs | Resolves unspaced Thai compounds; misses negation & ambiguity |
| **Controlled Aliases D** | **94.3%** | **33** | **44.20 µs** | 0.30 µs – 134.50 µs | **Recommended**: SKU precedence, supplier ambiguity, negation guard |

#### Category Breakdown (Method D)
- `thai_pure` (4/4, 100%)
- `thai_compound` (4/4, 100%)
- `english_exact` (3/3, 100%)
- `mixed_language` (2/3, 67%)
- `misspelling` (3/3, 100%)
- `synonym` (1/1, 100%)
- `supplier_ambiguity` (4/5, 80% — preserves ambiguity, no auto-guess)
- `sku_exact` (3/3, 100%)
- `pack_units` (4/4, 100%)
- `negation` (3/3, 100% — prohibits invalid matches)
- `incomplete` (2/2, 100%)

#### Method E (Syntactic Dependency Parsing) Evaluation
- Simpler Method D gap: 94.3% accuracy at 44 µs with 5 KB code footprint.
- Remaining 2 errors: catalog naming differences (`SMOKED BACON SLICED 1 KG` vs `SMOKED BACON`, `SALAMI PICCANTE` pack size in name). Syntax trees do not solve catalog naming differences.
- Dependency parsing cost: PyTorch/Stanza runtime >500 MB, 50–200 ms latency (1,000x slower).
- Verdict: **Method E rejected for search box querying**. Reserve UD parsing for sentence-level conversational voice transcripts only.

---

### Frozen Fixtures & Hashes

- `research/thaitrees/fixtures/catalog-fixture.json`:  
  SHA256: `466250C8C6D0B2CE620599FF9F58899A557D876DB373B4B8497AAC07F0B50566`
- `research/thaitrees/fixtures/evaluation-cases.json`:  
  SHA256: `B2C34F2D43578C91ACBDA34CBC59C96D1AD1F24777081520B3AEB2036FF2FB1E`

### Files Created

```
docs/mission/thaitrees/decisions.tsv
docs/mission/thaitrees/evaluation-report.md
docs/mission/thaitrees/experiment-plan.md
docs/mission/thaitrees/provenance.md
research/thaitrees/LICENSE
research/thaitrees/README.md
research/thaitrees/evaluator.ts
research/thaitrees/fixtures/catalog-fixture.json
research/thaitrees/fixtures/evaluation-cases.json
research/thaitrees/lexicon-subset.json
research/thaitrees/run-benchmark.ts
tests/thaitrees-evaluator.test.ts
```

### Reproducible Commands

```powershell
# Run evaluator tests
npx vitest run tests/thaitrees-evaluator.test.ts

# Run benchmark
node --experimental-strip-types research/thaitrees/run-benchmark.ts

# Lint check
npx oxlint research/thaitrees tests/thaitrees-evaluator.test.ts
```

### Production Isolation & Safety

- Modifies zero production files (`src/lib/search.ts`, `src/lib/productMatch.ts`, Firestore rules, build bundle untouched).
- No emulator ports used.
- Blockers: None.
- Next step: Parent review of SHA `c0d137bcf92a4f000626886e999df5e3b4af01fe`.