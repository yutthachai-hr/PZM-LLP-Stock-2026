# R31 R25 bounded read phases

Candidate only, based on preserved b52531b and merged current main2c759f7f. No Production
Rules/configuration activation. `RND_EXPERIMENTAL_RECEIVE_ENABLED` remains default-off.
Independent exact-head review and the separate Rules/rollout approval remain HOLD.

## Contract

Optional `TxContext.prefetch(DocumentRef[])` only warms the command-private REST adapter's
read cache. Existing browser/demo backends need not implement it; ordinary `get` semantics,
read-before-write restrictions and commit-time preconditions remain unchanged. No new
supplier ServerStore privilege, endpoint or client-side authority is introduced.

The REST boundary validates every reference before fetching. It deduplicates references,
limits a batch to200 documents and maps unordered responses by full Firestore document name.
Missing, duplicate or unrequested response rows fail closed; an absent document is cached
only when Firestore explicitly identifies it as missing. All updateTime/exists preconditions,
including read-only authority/revocation documents, are verified in the atomic commit.

Receipt phases:
1. Current user, revocation and operation receipt. A replay exits here with no commit.
2. Supplier, both counters, location, parents, identity claims, explicit existing/ordinary products.
3. Candidate product IDs and products referenced by existing claims.
4. Stock levels and deterministic operation movement IDs, before the shared receipt planner.
5. One atomic commit containing updates plus read-only verification preconditions.

Each conflict attempt starts with an empty cache and revalidates authority. Only known
ABORTED/FAILED_PRECONDITION conflicts retry (at most3 attempts). A transport failure remains
unknown outcome; recovering uses the same operationId, never an invented replacement ID.
The SKU counter must have room for every new product in the receipt, not just its first row.

## Measured bound and replacement for the temporary cap

Six new lines previously made33 adapter REST requests in the regression fixture. They now
make four batchGet requests plus one commit. The replacement line limit is50, still a bounded
command rather than an unbounded importer;51 is rejected before any database request.

The worst-case synthetic transport test uses50 distinct parents,50 stale claims pointing at
ordinary restored products,50 new product IDs and an image. Exact batch sizes are
`[3,104,100,100]`, and the commit has308 writes/verifications, below Firestore's500-operation
limit. Every batch is below200 references. Two injected conflicts then success cost15 REST
requests total, with only one set of50 movements. Mixed ordinary/new and explicit-existing/new
receipts retain the same upper bound; read-only replay makes one batchGet and no commit.

Real Firestore emulator tests exercise50-line batchGet/name mapping/updateTime/exists commit,
two simultaneous identical submissions, concurrent role change, concurrent revocation and a
lost response after a real commit. The normal successful command makes five REST requests.
Movements/levels/counters and repeated-operation results are checked, not inferred from status.

These are measured command-adapter requests, not a live Cloudflare invocation measurement.
Firebase identity/JWKS and service-account token acquisition occur outside this counter.
Even the15-request conflict path leaves substantial headroom under the50-subrequest Pages
budget; cold-auth overhead and staging behavior must be reviewed before activation. The
existing2MB body limit and1MB image validation remain unchanged.

## Regression evidence

- Meaningful RED before batching:33-vs5 requests,3-vs1 replay reads, missing prefetch contract.
- RED before lifting cap: valid50-line cases returned too_large; after batching they pass.
- RED counter integrity: six new rows could cross the999999999 ceiling; now refused prewrite.
- Targeted tests include unordered/omitted/duplicate/unknown batch responses and scope rejection.
- Full local unit1722 passed, Rules/emulator240 passed, E2E82 passed with2 existing skips;
  all TS projects/build/bundle/lint/i18n passed. No skips or test timeouts added.

First full unit attempt had a PDF inspection subprocess failure; that old test writes a
hard-coded shared mission evidence path and overlapped another worktree's suite. The exact
stderr was not retained, so shared-artifact contention is a hypothesis, not a proven cause.
Isolated PDF12/12 and serialized full unit1722/1722 then passed without changing PDF code.
First full Rules attempt lost its emulator process; the first debug log was overwritten by
E2E, so the exit1 cause remains unknown. A bounded standalone rerun passed240/240 with debug
output preserved. Neither earlier failed run is reclassified as a pass.

## Review focus / release limits

Review transaction preconditions on cached/missing/read-only documents, batch name matching,
all authority and master-data races, write budget and mixed-line arithmetic. Preserve earlier
M2 deletion protection, M3 stale-claim handling and M4 backup provenance behavior; those remain
unmerged behavior requiring independent review. This batching change does not itself approve
an irreversible provenance downgrade or an activation of experimental receiving.

The app's existing admin-only R&D command and fixed physical collection mapping are preserved.
It still has no newly invented brand-membership schema. Broader Stock trusted-command brand
membership/restore migration is separate. Product/PO deletion TOCTOU is not claimed fixed here.
