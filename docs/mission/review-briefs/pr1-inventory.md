Read-only inventory of legacy PR #1 (branch origin/rc/ops-os-rc1-candidate, head 4898dbb, 101 non-merge commits, merge base ad43971 on 8 Oct 2026) against current origin/main (af0136b) for PZM Stock (React + Firebase inventory app, brands Pizza Mania, Le Lapin, R&D).

Owner rule: PR #1 is never merged wholesale. Find which of its features already shipped on main (usually re-implemented in later PRs, so patch ids differ: `git cherry` matches only 1 commit) and which are genuinely missing, then propose small, separate PRs for the missing ones.

Work in C:/Users/Yutthachai/pzm-mission-control-20261014 only by reading git objects (`git log`, `git show`, `git diff`, `git grep <rev>`). Do not check out, commit, push or edit anything in any worktree except the two output files below. Do not run the app, emulators or tests. Do not spawn subagents. If the superpowers skill `writing-plans` is available, load it for the split proposal and say which SKILL.md path you loaded.

The commit list is in docs/mission/review-briefs/pr1-commits.txt (hash and subject).

For every commit, decide one status, with evidence a reviewer can check:
- ON_MAIN: the behaviour exists on origin/main. Cite the main commit or PR number and a file:line on origin/main.
- PARTIAL: some of it exists. Say what is missing.
- MISSING: not on main and still relevant.
- SUPERSEDED: main does the same job differently, or a later commit on the RC replaced it.
- RESEARCH_ONLY: agent, Laya, Goose, Rust integrity vectors, evidence or docs that belong on exp/real-stack, not in the production app.

Write:
1. C:/Users/Yutthachai/pzm-mission-control-20261014/docs/mission/pr1-inventory.tsv with columns: hash, subject, status, evidence, notes.
2. C:/Users/Yutthachai/pzm-mission-control-20261014/docs/mission/pr1-inventory.md: counts by status, then a proposed list of small PRs for MISSING/PARTIAL items. For each: title, the RC commits it takes, files touched, risk (data, rules, UI only), the tests that must come with it, and whether it needs separate owner approval (Firestore rules cutover, migrations, data authority or stock/financial automation always do).

Do not guess. If you cannot find evidence either way, mark the row PARTIAL with "unverified" in notes.

Final answer: the counts by status, the proposed PR list titles, and the row hashes you were least sure about.
