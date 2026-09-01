# CRM — Lead Flow

The vocabulary a salesperson and the CRM share when working a prospect from first
contact to a real customer record. Captured while redesigning the lead workspace.

## Language

**Lead**:
A prospect that does not yet exist in the shared address book — pre-Party, pre-Deal.
Qualifying a Lead is what creates the Party; a value/pipeline only exists afterwards, on
the resulting Deal.
_Avoid_: Contact (that is the address-book record a Lead becomes), Account, Opportunity

**Status**:
Where a Lead sits in its lifecycle — `new`, `contacted`, `qualified`, `disqualified`, or a
company's own settable stage. A single axis; a Lead has exactly one.
_Avoid_: Stage (that is the Deal board's term), state, phase

**Priority**:
How hot or urgent a Lead is (e.g. Hot/Warm/Cold) — a *separate* axis from Status. A display
signal for triage, not a lifecycle position.
_Avoid_: Temperature, score, rating (as synonyms — pick Priority)

**Timeline**:
The single chronological feed a person reads on a Lead. It contains two kinds of entry:
Activities and Audit events. Everything that happens to a Lead lands here — notes, calls,
emails, email opens, file attachments, survey responses, status changes.
_UI label_: the page/column that shows the whole Timeline is called **Activity**, because
that is what users call it; the precise model terms (Activity, Audit event) live underneath.
_Avoid_: Feed, log, history (when the unified reading surface is meant)

**Activity**:
Something a *person* did or will do, logged against a Lead — a note, call, email, meeting, or
task. A task is the only Activity that can be pending and completed.
_Avoid_: Event, interaction, touchpoint

**Audit event**:
Something the *system* recorded about a Lead — status changed, file attached, survey
received, lead created. Appears in the Timeline alongside Activities but is not something a
person authored.
_Avoid_: Log entry, system note, activity (an Audit event is not an Activity)

**Correspondence**:
The subset of the Timeline that is messages to and from the prospect — today, outbound
email. Rendered conversationally, but distinct from live chat, which does not exist here.
_Avoid_: Chat, messages, conversation (when outbound email is what is meant)

**Email open**:
A soft signal that a lead *probably* viewed a sent email, inferred from a tracking pixel.
Not proof — image-blocking suppresses it and Apple Mail Privacy Protection inflates it — so it
is always presented as likelihood, never certainty.
_Avoid_: Read, seen, viewed (as if confirmed)

**Survey submission**:
One response to a capture form (e.g. a Google Form) tied to a Lead — its raw answers and the
subset mapped onto Lead fields. A Lead may accumulate several over time.
_Avoid_: Form entry, response, customValues (that is only the mapped subset, not the whole submission)
