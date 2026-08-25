# 03 — One-click convert & Move to Contacts

**What to build:** Converting a qualified lead into a real contact is one click, available both
from the lead's own screen and as a "Move to Contacts" button in its own column on the leads
table row — composing Parties' own endpoints exactly as the shipped `crm-sales` spec requires,
never writing a `Party` or a `PartyRole` from `crm`'s backend.

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] The lead's status is visible and settable directly from the board.
- [x] A "Move to Contacts" action is available both on the lead detail screen and as a button in
      its own column on the leads table row.
- [x] Converting searches `PartyDirectory` by the lead's email and organisation name first,
      offering any match for linking before offering to create a new Party.
- [x] Converting a lead with no match creates a new Party via Parties' own `POST /api/parties`,
      then calls `crm`'s existing `qualify` endpoint with the resulting `partyId`, then tags the
      Party `prospect` via Parties' own `POST /parties/:id/roles` — three composed frontend
      calls; `crm`'s backend writes neither a `Party` nor a `PartyRole`.
- [x] After converting, the user is taken to the Contacts board with the new party selected.
- [x] Converting a lead that is already qualified or currently disqualified is refused, with the
      existing refusal message.
- [x] `crm.lead.qualified` is still emitted, unchanged from the shipped behavior.
