# 02 — Category model: industry templates, and whether a category is a Product

Type: grilling

## Question

How are expense categories defined, and where do they live?

- Every company needs its own categories (a clinic's look nothing like a clothing outlet's or a
  school's), but industry preset templates were requested — where do templates live (a fixed
  catalog in code vs. something a company picks at setup), and what happens once a company
  customizes a template afterward?
- The pasted source spec described "every expense category is configured as an internal
  product." This platform already has a Core Products module. Does a category *reuse* Products
  (a real `dependsOn: products` edge, the way Inventory already depends on Products) or is it a
  distinct concept owned by Expenses? This is a module-boundary decision, not a detail —
  `check:conformance` will hold either answer to it.
- What does a category carry beyond a name — some accounting classification tag, following ADR
  0008's pattern (the emitting module carries value + classification in its event; it never
  holds a foreign key into Accounting)?

## Comments

**Explicitly not decided here:** which specific industry templates ship (clinic, clothing
outlet, school, etc.) or their exact category lists — that's detail that follows once the
*mechanism* (where templates live, how they're picked and customized) is settled.
