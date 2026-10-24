# Triage vocabulary

Preflight read the live repository labels on22Oct2026: `bug`, `documentation`, `duplicate`,
`enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`.
Existing open stock-integrity issues had no triage labels. Preserve those conventions;
this integration creates no labels and relabels no issues.

| Skill role | Representation |
|---|---|
| needs-triage | `Status: needs-triage` in issue body |
| needs-info | `Status: needs-info` in body; existing `question` label when appropriate |
| ready-for-agent | `Status: ready-for-agent` in body |
| ready-for-human | `Status: ready-for-human` in body; existing `help wanted` when appropriate |
| wontfix | Existing `wontfix` label, with the decision/reason recorded |

`bug`/`enhancement` are types, not readiness states. Never substitute them for readiness.
Where upstream skills say to apply a default triage label, use the representation above.
Before any future label addition, re-read existing labels/conventions; installation is not
blanket authorization to create an upstream label set.
