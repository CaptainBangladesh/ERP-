# CRM Contacts board

A centralised board for every individual business relationship — the people behind the
accounts, sitting beside Leads and Deals in the CRM.

## Why this rather than the existing address book

`/parties` is the address book: every party, both kinds, with roles, addresses and merging.
It belongs to the `parties` module, which **may not depend on `crm`** — so it can never show
a Deals column or an activity timeline. The Contacts board is the CRM's own view of the same
people, and the dependency runs the way the module graph already allows: `crm → parties`.

## What a contact is

`Party(kind: 'person')`. Nothing new is modelled. The account a contact belongs to is
`Party.organisationId`, which already exists and is already filterable.

## The five functions

1. **Relationship management** — name, email, phone, account, roles and status for every
   person, editable in place on the board.
2. **Account association** — a contact's account is a picker of this company's organisations.
   The board *groups by account*, so every stakeholder of a company reads as one block.
3. **Filtering and sorting** — search, plus account / status / role filters and a sort, all
   served by the parties list endpoint that already declares those fields.
4. **Deal sync** — a Deals column per contact, read from `Deal.partyId`. Associating a deal
   with a contact makes it appear here with no second act.
5. **Activity tracking** — the detail panel carries `ActivityTimeline`, which already
   supports `parentKind='party'`.

## What has to be built

Everything above is already on the wire except the deal roll-up: a board of 100 contacts
must not make 100 deal requests. One new CRM read answers it for many parties at once.

## Out of scope

The Accounts board (organisations and their stakeholders). Its nav entry stays pointed at
`/parties` until it is built.
