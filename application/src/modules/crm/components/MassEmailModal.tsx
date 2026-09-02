import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CAMPAIGN_PATHS,
  EMAIL_TEMPLATE_PATHS,
  MAILBOX_PATHS,
  type CampaignResponse,
  type CampaignRecipientListResponse,
  type EmailTemplateListResponse,
  type MailboxConnectionListResponse,
  type SendCampaignBatchResponse,
} from '@erp/shared';
import { Button, Modal, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * One email to everything ticked on the board.
 *
 * There is already an engine for this — a Campaign is a mailbox, a template and a set of
 * recipients — and it already accepts an explicit list of leads as its segment. What was
 * missing was a way to *reach* it from the selection somebody has actually made, so this is
 * a doorway onto the campaign machinery rather than a second sending path: the same
 * unsubscribe honouring, the same duplicate-address collapsing, the same open tracking.
 *
 * Sending is three requests, in this order, and the order is not incidental:
 *
 *   1. **create** — a draft campaign named after what the person is doing.
 *   2. **materialize** — turns the segment into recipient rows, and *this* is where leads
 *      with no email, unsubscribed addresses and duplicates get set aside. It is a separate
 *      step so the count can be shown before anything leaves.
 *   3. **send-batch**, repeatedly — the endpoint sends at most a hundred at a time, so a
 *      selection larger than that needs the loop rather than one hopeful call.
 *
 * Between (2) and (3) the person is shown who is actually going to be written to and who was
 * set aside and why. A mass email is the one act on this board that cannot be undone by
 * repeating it with a different value, so it gets the pause that Delete gets.
 *
 * **Known loose end.** Cancelling after (2) leaves a materialized draft behind, because there is
 * no endpoint that removes a campaign — `CAMPAIGN_PATHS` has create, read, update, materialize
 * and send-batch, and nothing else. A draft that sent to nobody is harmless and appears on the
 * Campaigns page where it can be finished or ignored, so this is deliberately left rather than
 * papered over by moving `create` after the confirmation: doing that would mean showing the
 * excluded-recipient count *before* anything has worked out who is excluded, which is the one
 * thing this dialog exists to do.
 */
export function MassEmailModal({
  leadIds,
  onClose,
  onSent,
}: {
  leadIds: string[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [mailboxId, setMailboxId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [campaign, setCampaign] = useState<CampaignResponse>();
  const [isWorking, setIsWorking] = useState(false);
  const [sentCount, setSentCount] = useState<number>();
  /** How many have actually left, updated per batch so a long send is visibly moving. */
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();

  const mailboxes = useQuery({
    queryKey: ['crm', 'mailboxes', 'list'],
    queryFn: () => api.get<MailboxConnectionListResponse>(MAILBOX_PATHS.mailboxes),
  });
  const templates = useQuery({
    queryKey: ['crm', 'email-templates', 'list'],
    queryFn: () => api.get<EmailTemplateListResponse>(EMAIL_TEMPLATE_PATHS.templates),
  });

  const connected = useMemo(
    () => (mailboxes.data?.items ?? []).filter((mailbox) => mailbox.status === 'connected'),
    [mailboxes.data],
  );
  const templateItems = templates.data?.items ?? [];

  // Prefilled rather than left blank: with one mailbox and one template — which is most
  // companies — there is nothing to choose, and a required empty select is just a step.
  useEffect(() => {
    if (!mailboxId && connected[0]) setMailboxId(connected[0].id);
  }, [connected, mailboxId]);
  useEffect(() => {
    if (!templateId && templateItems[0]) setTemplateId(templateItems[0].id);
  }, [templateItems, templateId]);

  /** Who materializing decided is actually reachable, and who it set aside. */
  const recipients = useQuery({
    queryKey: ['crm', 'campaigns', campaign?.id, 'recipients'],
    queryFn: () => api.get<CampaignRecipientListResponse>(CAMPAIGN_PATHS.recipients(campaign!.id)),
    enabled: Boolean(campaign),
  });

  const sendable = (recipients.data?.items ?? []).filter((one) => one.status !== 'excluded');
  const excluded = (recipients.data?.items ?? []).filter((one) => one.status === 'excluded');

  function report(failure: unknown, saidBySite: string) {
    const fromServer = failure instanceof ApiFailure ? `${failure.message} ` : '';
    setError(`${fromServer}${saidBySite}`.trim());
  }

  async function prepare() {
    setError(undefined);
    setIsWorking(true);
    try {
      const draft = await api.post<CampaignResponse>(CAMPAIGN_PATHS.campaigns, {
        // Named so it can be found again: a partial send is finished from the Campaigns page,
        // and "12 leads from the board, 3 Feb" is something a person can pick out of a list.
        name: `${leadIds.length} leads from the board, ${new Date().toLocaleDateString()}`,
        mailboxConnectionId: mailboxId,
        templateId,
        segmentConfig: { leadIds },
      });
      await api.post<CampaignResponse>(CAMPAIGN_PATHS.materialize(draft.id));
      setCampaign(draft);
    } catch (failure) {
      report(failure, 'Could not prepare this send.');
    } finally {
      setIsWorking(false);
    }
  }

  /**
   * Sends the campaign, a batch at a time, and says how far it has got.
   *
   * The endpoint sends at most a hundred and reports what is left, so "everybody" is a loop on
   * its own answer rather than a guess about how many rounds it takes. Two things make that loop
   * safe to watch rather than a frozen button:
   *
   *  - `progress` is written after every batch, so a nine-hundred-lead send is nine visible
   *    steps instead of nine silent minutes behind one unchanging "Sending…".
   *  - a batch that throws stops the loop but keeps the count. A partial send is the one act on
   *    this board that cannot be undone by repeating it, so the number that already went out is
   *    the most important thing on the screen — and the campaign is named, because finishing it
   *    means going to Campaigns and sending the rest rather than starting again here, which
   *    would write to everybody who already received it.
   *
   * The `batchSent === 0` guard is what stops a campaign the server will not advance from
   * spinning forever.
   */
  async function send() {
    if (!campaign) return;
    setError(undefined);
    setIsWorking(true);
    let sent = 0;
    try {
      for (;;) {
        const batch = await api.post<SendCampaignBatchResponse>(
          CAMPAIGN_PATHS.sendBatch(campaign.id),
          { batchSize: 100 },
        );
        sent += batch.batchSent;
        setProgress(sent);
        if (batch.remainingPending === 0 || batch.batchSent === 0) break;
      }
      setSentCount(sent);
      onSent();
    } catch (failure) {
      const stopped =
        sent === 0
          ? 'Nothing went out.'
          : `${sent} of ${sendable.length} went out before it stopped. The rest are still pending on the campaign named "${campaign.name}" — finish it from Campaigns rather than sending again here, or the ${sent} who already have it will get it twice.`;
      report(failure, stopped);
      if (sent > 0) onSent();
    } finally {
      setIsWorking(false);
    }
  }

  const nothingToSendWith = connected.length === 0 || templateItems.length === 0;

  return (
    <Modal
      onClose={onClose}
      title="Mass email"
      icon="✉"
      description={`One email to the ${leadIds.length} ${leadIds.length === 1 ? 'lead' : 'leads'} you ticked.`}
      footer={
        sentCount !== undefined ? (
          <Button onClick={onClose}>Done</Button>
        ) : campaign ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={isWorking || sendable.length === 0}>
              {isWorking ? `Sending… ${progress} of ${sendable.length}` : `Send to ${sendable.length}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => void prepare()}
              disabled={isWorking || !mailboxId || !templateId || nothingToSendWith}
            >
              {isWorking ? 'Checking…' : 'Continue'}
            </Button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}

      {sentCount !== undefined ? (
        <p className="text-sm font-semibold text-slate-800">
          Sent to {sentCount} {sentCount === 1 ? 'lead' : 'leads'}. Every send is on each lead's
          timeline, and opens will appear there as they come in.
        </p>
      ) : campaign ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-semibold text-slate-800">
            {sendable.length} of {leadIds.length} will be written to.
          </p>
          {excluded.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-900">
                {excluded.length} set aside
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-amber-800">
                {excluded.slice(0, 8).map((one) => (
                  <li key={one.id}>
                    {one.leadName} — {EXCLUSION_REASONS[one.excludeReason ?? ''] ?? one.excludeReason}
                  </li>
                ))}
                {excluded.length > 8 && <li>…and {excluded.length - 8} more.</li>}
              </ul>
            </div>
          )}
        </div>
      ) : nothingToSendWith ? (
        <p className="text-sm text-slate-600">
          {connected.length === 0
            ? 'Connect a mailbox before sending — there is nothing to send from yet.'
            : 'Write an email template first — a mass email sends a template, not a one-off message.'}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Select
            id="mass-email-mailbox"
            label="Send from"
            value={mailboxId}
            onChange={setMailboxId}
            options={connected.map((mailbox) => ({ value: mailbox.id, label: mailbox.emailAddress }))}
          />

          <Select
            id="mass-email-template"
            label="Template"
            value={templateId}
            onChange={setTemplateId}
            options={templateItems.map((template) => ({ value: template.id, label: template.name }))}
            hint="Every lead gets the same message, with its own tags filled in."
          />
        </div>
      )}
    </Modal>
  );
}

/** The service's reasons, in words somebody reading the list would use. */
const EXCLUSION_REASONS: Record<string, string> = {
  no_email: 'no email address',
  unsubscribed: 'unsubscribed',
  duplicate_email: 'same address as another lead here',
};
