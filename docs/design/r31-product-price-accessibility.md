# R31 pricing candidate

Starts at preserved ff07e68753dea307cb5b3a7374a8c04476b29a05 and merges main2c759f7f.
Remote PR37 head805cb163 is not an ancestor of this local lineage. Preserve both histories;
do not force-push the local candidate onto PR37 or treat its old CI as this candidate's CI.

## Fix and evidence

The grid's navigation button wrapped CostFigure, whose desktop branch contains native
`details`/`summary`. Clicking the disclosure could also navigate; nested interactive content
is invalid. Each grid card is now an article with its navigation button and a sibling cost
disclosure. The table's disclosure and the cost/format/export calculation remain unchanged.

Browser RED: both TH/EN new tests found1 visible `button details` where0 is required.
Browser GREEN:14/14 isolated demo tests now pass, covering:
- independent keyboard-opened grid disclosure without navigation; product button still navigates;
-390px grid readability/overflow and phone/small-tablet card invoice hint;
- all3 brands, TH/EN, practical1440/1536 desktop widths and the wider breakpoint curve;
- selectable/searchable/sortable SKU, visible Location header, name wrapping;
- numeric Excel export and accessible summary naming.

The responsive configuration is now explicitly invoked by the existing CI e2e job, not just
a local-only configuration. No retries/timeouts/skips added. Local full unit1673, all TypeScript
projects/build/bundle/lint/i18n pass. Cost-display tests retain4-decimal precision and keep
invoice-unit hints secondary to authoritative cost; no catalogue price or stock write changed.

Independent review and current-head full CI remain release gates. This is not a hardware
screen-reader test, live account QA or a repair for product count/rebase concurrency. No
Production data, Rules, schema, provider or Worker configuration change.
