# 01 — Deal roll-up by party

Status: claimed
Type: task

The Contacts board shows what each contact is worth in flight. Reading that per row is a
request per contact; this answers for the whole page at once.

## Surface

`GET /api/crm/deals/by-party?partyIds=a,b,c` → `PartyDealRollupResponse`

Per party: open / won / lost counts, and the summed open and won value. A party with no
deals is simply absent from `items` — the board reads a missing entry as zero.

**Route order matters.** It must be declared before `deals/:id`, or Nest resolves
`by-party` as an id.

## Rules

- No ids → `{ items: [] }`, no query.
- Ids are capped, so the endpoint cannot be asked to roll up the whole company at once.
- Won / lost is the *Stage's* `outcome`, read fresh — never stored on the Deal.
- Money is summed with `Money`, never with floats.
