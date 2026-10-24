# Domain documents

Use a single context for this repository. Read root `GLOSSARY.md` when it exists and ADRs
relevant to the task. If a future `GLOSSARY-MAP.md` exists, follow its context pointers.
Preserve existing ADR locations, `docs/superpowers/` specifications/plans, HANDOFF.md and
release documentation; this setup does not replace or migrate them.

Absent glossary/ADR files are not errors. Create `GLOSSARY.md` only when a domain term is
resolved, and `docs/adr/` only when an actual decision merits an ADR. No empty scaffold or
invented business vocabulary is required by installing skills.

Use agreed domain language in findings, specs and tickets. Surface conflicts with existing
ADRs/Owner policy instead of silently changing them. Any schema, Rules or Production-data
change still needs its existing separate approval.
