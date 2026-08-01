# 04 — API conventions, the shared data table, and exact numbers

**What to build:** The list experience every screen reuses, the conventions all forty modules
follow, and the numeric primitives everything else depends on.

On screen: a list with a clear empty state on a fresh account, then sorting, filtering, searching
and paging once data exists, staying fast as it grows, with distinct loading and error states.

Underneath: one list shape, one error shape, one filter and sort convention — and money and
quantity types that stay exact. Those must land before any ledger exists, because retrofitting
numeric precision after movements have accumulated means rewriting history.

Everything here is a **primitive with no business meaning**, which is what earns it a place in the
shared package. Anything with rules, tables or screens is a module instead.

**Blocked by:** 03 — Tenant scoping, and the HRM shape stub

**Status:** ready-for-agent

- [ ] One list response shape is used by all list endpoints, carrying items and paging information
- [ ] One error response shape carries a machine-readable code and a human-readable message
- [ ] Validation failures identify the offending fields
- [ ] Search, filter, sort and pagination follow one convention across all modules
- [ ] Request and response types live in the shared package and are used by both workspaces
- [ ] A shared table component provides sorting, filtering and paging with hand-written markup
- [ ] The table is built on headless logic only; nothing renders markup or CSS on our behalf
- [ ] Server data is managed by a shared query layer providing caching and refresh after changes
- [ ] Screens show distinct empty, loading and error states, with empty guiding the first action
- [ ] The list stays responsive with several thousand records
- [ ] Monetary values and quantities are stored and computed with exact precision, never floating
      point, and quantities support fractional amounts
- [ ] Currency is carried with monetary values rather than assumed
- [ ] Arithmetic across differing currencies is refused rather than silently wrong
- [ ] Rounding happens only at explicit, defined points
- [ ] Values survive database to API to browser and back without alteration
- [ ] Shared input and display components format and validate these types consistently
- [ ] Backend tests cover paging, filtering, sorting, the error shape, and precision across long
      sequences of arithmetic
- [ ] Frontend tests cover rendering, sorting, filtering, paging, and the three states
