# Landing a Google Form in the CRM

Google Forms has no webhook of its own, and this application deliberately does not integrate
with the Google Forms API (no Pub/Sub `responses.watches`). The supported path is the one every
other third party uses: a **webhook capture source** here, and a small **Apps Script** trigger on
the form that posts each response to it.

Once it is set up, a response creates a Lead if nobody matches, and **attaches to the existing
Lead** if somebody does — filling in only the fields that Lead has left empty. See
`docs/adr/0012` for why a public form is never allowed to overwrite what you already know.

## 1. Create the capture source

**Forms** in the left-hand menu (`/crm/capture-sources`) → **Add Source** → kind
**Webhook (Third-party JSON POST URL)**. Give it the form's name — that name is snapshotted onto
every submission, so it is what the Survey tab shows later.

Leave the field mapping empty for now; you need the question IDs first.

## 2. Find each question's item ID

Open the form → **Extensions → Apps Script**, paste this, and run `listItemIds` once. The IDs
appear under **Execution log**.

```js
function listItemIds() {
  FormApp.getActiveForm().getItems().forEach(function (item) {
    Logger.log('entry_' + item.getId() + '  ' + item.getTitle());
  });
}
```

**Map by item ID, never by question title.** A title is free text somebody will reword, and two
questions may share one; the ID is assigned once and does not change when the wording does.

## 3. Map the questions onto Lead fields

Back on the capture source, add one mapping row per question you want to keep:

| Inbound JSON key | Lead field |
| ---------------- | ---------- |
| `entry_1841203`  | `name` |
| `entry_9922017`  | `email` |
| `entry_4410855`  | `phone` |
| `entry_7781200`  | `organisationName` |
| `entry_2093345`  | `budget` (a custom field you defined on the Leads board) |

The built-in field keys are `name`, `email`, `phone`, `organisationName`, `sourceId`, `groupId`
and `assignedToUserId`. Anything else must be a **custom field** you have defined — an unmapped
key is not an error, it is simply kept on the submission (see step 5).

## 4. Post the responses

**View Webhook URL** on the source shows the URL and the script, ready to copy with the token
already in it. In Apps Script, paste it, save, then add a trigger: **Triggers → Add Trigger →**
function `onFormSubmit`, event source **From form**, event type **On form submit**.

```js
function onFormSubmit(e) {
  var payload = {};
  e.response.getItemResponses().forEach(function (item) {
    payload['entry_' + item.getItem().getId()] = item.getResponse();
  });

  UrlFetchApp.fetch('https://your-host/api/public/capture/cs_<your token>', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
```

Submit the form once to test. The response shows up on the Lead's **Survey** tab, and a
`📝 Survey response received` entry appears on its Activity feed.

## 5. Answers that map to nothing

Every answer is stored in full, mapped or not — an answer with nowhere to go is still something
the lead told you. Unmapped ones show as **Not mapped** on the Survey tab, where **Save as a
field** promotes one into a custom field. Nothing is auto-provisioned: the endpoint is public,
and a stranger should not be able to grow your schema by submitting a form.

## Notes

- **The token is the credential.** Anyone holding the URL can post to it. Rotating it on the
  source invalidates the old one — the Apps Script must then be updated with the new URL.
- **Rate limited** to 60 submissions per token per 10 minutes.
- **A repeat response never creates a duplicate** Lead; it attaches to the match. That is why a
  form asking for an email address is worth setting up — the email is what matches.
