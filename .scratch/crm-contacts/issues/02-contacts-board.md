# 02 — The Contacts board

Status: claimed
Type: task
Blocked by: 01

`/crm/contacts`, modelled on the Leads board, grouped by account.

## Board

- Groups are this company's organisations, plus a final "No account" group. A group header
  names the account and counts its stakeholders — requirement 2 answered by the layout.
- Columns: Contact (name), Email, Phone, Roles, Deals, Status.
  **No Account column**, though this ticket first asked for one: the board is already grouped
  by account, so a per-row copy of the same fact is noise. The account is changed in the
  detail panel, where a deliberate act belongs.
- Name, email and phone are editable in place. Account is a picker in the detail panel, so
  moving a stakeholder between companies is one act — and taking them off one is another,
  which needed `UpdatePartyBody` to accept an emptied field (see below).
- Roles and status are **shown** on the board, not edited there. Editing a role is two
  endpoints (`POST`/`DELETE` on a party's roles) rather than a field write, and neither is
  among the five functions the board was asked for. Deferred rather than done badly.
- Deals column reads the roll-up from ticket 01.
- Paged. The board reads the server's own total rather than the size of the page in hand.

## Filters and sorting

Search, account, status and role filters, plus a sort — every one of them a field
`PARTY_LIST` already declares, so the server orders the board and this screen never sorts a
page it happens to be holding.

## What this needed from parties

`UpdatePartyBody` made its three nullable columns `clearable` rather than `optional`. Before
that, choosing "No account" sent a field the platform read as "do not touch it", so the
control looked as though it had worked and had not. `UpdateLeadBody` in crm had accepted
exactly this since Leads shipped, so the two boards disagreed about the same edit.

## Detail panel

Name / email / phone / account / roles, the contact's deals, and `ActivityTimeline` with
`parentKind='party'`.

## Permissions

Read needs `parties:parties:read`; editing needs `parties:parties:write`. The Deals column
needs `crm:deals:read` and hides without it; the timeline gates itself on
`crm:activities:read` as it already does.
