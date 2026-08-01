# 03 — Tenant scoping, and the HRM shape stub

**What to build:** A guarantee that one company can never see another's data, enforced by the system
rather than remembered by developers. Company context is established once per request from the
session and applied automatically to every query. A query attempted without company context fails
loudly instead of quietly returning everything.

Built alongside it: the **HRM shape stub**, the first of the two deliberately dissimilar modules
that keep the platform from hardening around inventory. It is small — a table or two — and shaped
like payroll: a periodic calculation over a date range rather than a reaction to an event, a
sensitive personal field, and a record that can never be edited once created.

The stub earns its place immediately. Its sensitive field forces tenant scoping to support data
that is company-scoped *and* further restricted — a case inventory never produces, and one that is
expensive to add to the mechanism after forty modules depend on it.

**Blocked by:** 02 — Identity and access, as the first manifest-driven module

**Status:** ready-for-agent

- [ ] Company context is derived from the session once per request and carried for its duration
- [ ] Every query against a company-owned table is scoped automatically, with no per-call filter
- [ ] A query against a company-owned table without company context throws immediately
- [ ] Writes record the acting company automatically; a caller cannot write into another company
- [ ] Reads, updates and deletes by direct identifier cannot cross companies
- [ ] Tables that are not company-owned are explicitly marked as such
- [ ] A field or record can be marked as restricted beyond company scope
- [ ] The HRM shape stub exists as a module, with a periodic calculation, a sensitive field, and a
      record that cannot be edited after creation
- [ ] The stub is registered purely through its manifest
- [ ] The stub's sensitive field is unreadable without the required access
- [ ] Backend tests create two companies and assert isolation for read, update and delete
- [ ] A test proves omitting company context raises rather than returning unscoped rows
- [ ] The mechanism is documented, including how to add a company-owned or restricted table
