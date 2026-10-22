# Issue tracker: GitHub

Issues/specs live in `yutthachai-hr/PZM-LLP-Stock-2026` GitHub Issues. Use `gh` inside
the repository; verify the remote before a write. PRs as a request surface: **no**.

- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,labels` with suitable filters.
- Publish an approved spec/ticket: `gh issue create --title "..." --body-file <file>`.
- Read the actual issue and comments when a skill is given a ticket reference.
- Preserve parent issues; do not close/change them merely because tickets were generated.
  Prefer native sub-issue/blocking relationships when the installed gh/API supports them;
  otherwise include `Part of #<parent>` and `Blocked by: #<issue>` in the body.

Read `triage-labels.md` before applying labels. A skill's default `ready-for-agent` means
an issue-body readiness state here, not permission to create a new GitHub label.

Publishing, assigning or closing real issues is not part of a skill installation smoke test.
