# 01 — Payee model: employee reimbursement vs. company card vs. vendor bill

Type: grilling

## Question

When someone records an expense, who is it owed to, and how does that change what the record
needs? Three shapes were named in the original ask: an employee is reimbursed out of pocket, the
company pays directly (card/bank), or a vendor sends a bill (accounts payable, tied to the
existing Parties module).

Resolve:

- Is payee type a fixed enum on every expense record, or a polymorphic reference (employee vs.
  Party vs. "company account")?
- Does a vendor bill's payee reuse the Parties module (a real `dependsOn: parties` edge), the way
  Products and Inventory already depend on modules they need — or something narrower?
- Is "employee" resolved via Identity (the acting user) or does it need HRM's Employee shape stub
  (foundation ticket 03) for someone who isn't a system user at all?
- How does payee type change approval or Accounting's payable account, even though both of those
  stay fog for now — name the shape clearly enough that those tickets aren't guessing later.

This is the most load-bearing fork on the map: it decides a real module dependency (Parties,
possibly Identity/HRM) and shapes the Accounting module's payable structure before that module's
own ticket can be written.
