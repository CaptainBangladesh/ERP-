# 02 — Phase 1 metrics: which inventory numbers, and in what form

Type: grilling

## Question

Data already exists from `erp-foundation-inventory` tickets 08–13: stock levels by location,
movement history (receipts, issues, adjustments, transfers), and stock valuation. "Core metrics"
was named as the goal but never pinned to specifics.

Resolve:

- Which of stock-on-hand, valuation (point-in-time vs. trend-over-time), movement/turnover
  history, and anything else actually ships in phase 1 — all of them, or a smaller first slice?
- For each chosen metric: a single current value, a list/table, or a trend over time? Trend
  metrics raise the data-freshness question this map's Notes flags (real-time query vs.
  snapshot) — resolve it or explicitly punt it, per metric.
- Does any chosen metric aggregate across locations, or is location-level granularity required?
- Name the metrics precisely enough that ticket 04 (query-mechanism gap) and ticket 05
  (dashboard UI) aren't guessing.
