# Landing a Google Form in the CRM

Google Forms has no webhook of its own, and this application deliberately does not integrate
with the Google Forms API (no Pub/Sub `responses.watches`). The supported path is the one every
other third party uses: a **webhook capture source** here, and a small **Apps Script** trigger on
the form that posts each response to it.

Once it is set up, a response creates a Lead if nobody matches, and **attaches to the existing
Lead** if somebody does — filling in only the fields that Lead has left empty. See
`docs/adr/0012` for why a public form is never allowed to overwrite what you already know.

## 1. Create the capture source

**Forms** in the left-hand menu (`/crm/capture-sources`) → **New Capture Source** → kind
**Webhook (Third-party JSON POST URL)**. Give it the form's name — that name is snapshotted onto
every submission, so it is what the Survey tab shows later.

## 2. Post the responses

**View Webhook URL** on the source shows the URL and the script, ready to copy with the token
already in it. In the Google Form choose **Extensions → Apps Script**, paste it, save, then add a
trigger: **Triggers → Add Trigger →** function `onFormSubmit`, event source **From form**, event
type **On form submit**.

```js
function onFormSubmit(e) {
  var payload = {};

  e.response.getItemResponses().forEach(function (item) {
    var question = item.getItem();
    var title = question.getTitle();
    var answer = item.getResponse();
    var type = question.getType();

    // A grid ("multiple-choice grid" / "checkbox grid") asks several sub-questions at once.
    // Google returns one answer per row, in row order, but hands back only the grid's *title* —
    // so send each row as its own "Title — Row question" entry. Without this the CRM receives a
    // bare "Yes, Yes, No" with nothing to say which row each answer belongs to.
    if (type === FormApp.ItemType.GRID) {
      question.asGridItem().getRows().forEach(function (rowLabel, i) {
        if (answer[i]) payload[title + ' — ' + rowLabel] = answer[i];
      });
    } else if (type === FormApp.ItemType.CHECKBOX_GRID) {
      question.asCheckboxGridItem().getRows().forEach(function (rowLabel, i) {
        if (answer[i] && answer[i].length) payload[title + ' — ' + rowLabel] = answer[i];
      });
    } else {
      payload[title] = answer;
    }
  });

  UrlFetchApp.fetch('https://your-host/api/public/capture/cs_<your token>', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
```

Every answer is posted under its **question title** — "Merchant Category", not an opaque id — so
it lands on the Lead's Survey tab already readable, with no per-question mapping to configure. A
**grid** question is flattened to one entry per row ("Website Usability Assessment — Is the
website mobile-responsive?"), so each sub-question keeps its own answer instead of collapsing into
an unlabelled list. Submit the form once to test: the response shows up on the Lead's **Survey**
tab, and a `📝 Survey response received` entry appears on its Activity feed.

> **Already collecting responses with the older one-line script?** Re-paste this version to gain
> the grid sub-questions. Only responses submitted *after* the change carry them — a grid answer
> already stored as "Yes, Yes, Yes" can't be relabelled, because the row titles were never sent.

## 3. Add one mapping so responses find the right Lead

A webhook source keeps every answer, but it only *matches or creates* a Lead from the fields you
map. Add a single mapping row on the source: the question that holds the lead's name → `name`
(and, if the form asks for them, email → `email`, phone → `phone`). Type the question title
exactly as it reads on the form.

| Inbound JSON key | Lead field |
| ---------------- | ---------- |
| `Merchant Name`  | `name` |
| `Email`          | `email` (only if the form collects it) |
| `Phone`          | `phone` (only if the form collects it) |

With the name mapped, a response from "Cloth Heaven" attaches to the existing "Cloth Heaven"
lead (matching is case-insensitive) instead of creating a duplicate. Without any mapping, every
response would create a fresh `Web Submission` lead — the answers would still be captured, just
on the wrong row.

The built-in field keys are `name`, `email`, `phone`, `organisationName`, `sourceId`, `groupId`
and `assignedToUserId`. Map a question onto anything else only if it is a **custom field** you
have defined on the Leads board; an unmapped key is not an error, it is simply kept on the
submission (see step 4).

> **Renaming a mapped question** breaks its match until you update the mapping — so map the few
> identifying questions (name/email/phone), whose wording is stable, and leave the rest unmapped.
> An unmapped question that gets reworded just shows under its new title; nothing is lost.

## 4. Answers that map to nothing

Every answer is stored in full, mapped or not — an answer with nowhere to go is still something
the lead told you, and this is what makes the whole research form visible to whoever works the
lead. Unmapped answers show as **Not mapped** on the Survey tab, where **Save as a field**
promotes one into a custom field. Nothing is auto-provisioned: the endpoint is public, and a
stranger should not be able to grow your schema by submitting a form.

## Notes

- **The token is the credential.** Anyone holding the URL can post to it. Rotating it on the
  source invalidates the old one — the Apps Script must then be updated with the new URL.
- **Rate limited** to 60 submissions per token per 10 minutes.
- **A repeat response never creates a duplicate** Lead; it attaches to the match. That is why a
  form asking for an email address is worth setting up — the email is what matches most reliably.
- **"Fill Form for Lead"** on the Survey tab is for *web-form* sources only. A webhook source is
  fed by Google (or Zapier, Make, your own site); to record a response by hand, use **Add Manual
  Response**.
