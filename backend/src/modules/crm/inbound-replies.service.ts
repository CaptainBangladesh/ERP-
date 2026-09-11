import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MAILBOX_ERROR_CODES, type MailPollResponse } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { CompanyMailboxes, type CompanyMailAccount } from '../../platform/company';
import { decryptSmtpPassword } from '../../platform/secrets';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME } from './audit-events';
import { imapHostFor } from './imap-host';
import {
  InboundMailReader,
  type InboundMailboxConfig,
  type InboundMessage,
} from './inbound-mail-reader';

/** Enough messages that a normal poll clears the mailbox, few enough that a flooded one cannot outrun the request deadline. */
const MAX_MESSAGES_PER_POLL = 100;

/** How much of a reply's body the Timeline entry carries — a preview, not the whole thread. */
const PREVIEW_CHARS = 500;

/**
 * Reads replies out of company mailboxes and records them on the leads they answer.
 *
 * The inbound half of `LeadOutreachService`: where that sends a 1:1 email and logs a "sent"
 * entry, this reads what came back and logs a "received" one, so a reply lands beside the
 * message it answers instead of only in whoever's mailbox the account forwards to.
 *
 * Driven by an external scheduler over `POST …/mailboxes/poll`, because the server runs where a
 * timer cannot be trusted to (a free tier that sleeps when idle). The trigger is public and so
 * gated by a shared secret; everything past the gate is ordinary tenant-scoped work, run one
 * company at a time by `CompanyMailboxes.forEach`.
 */
@Injectable()
export class InboundRepliesService {
  private readonly logger = new Logger(InboundRepliesService.name);

  constructor(
    private readonly companyMailboxes: CompanyMailboxes,
    private readonly reader: InboundMailReader,
    @InjectPrisma() private readonly prisma: ScopedPrisma,
  ) {}

  async poll(providedSecret: string | undefined): Promise<MailPollResponse> {
    this.authorize(providedSecret);

    let companiesPolled = 0;
    let messagesSeen = 0;
    let repliesRecorded = 0;
    const errors: string[] = [];

    await this.companyMailboxes.forEach(async (account) => {
      companiesPolled += 1;
      try {
        const result = await this.pollCompany(account);
        messagesSeen += result.seen;
        repliesRecorded += result.recorded;
      } catch (cause) {
        // Caught per company so one unreachable mailbox does not end the run for the rest, and
        // named without the mailbox because this summary is read from an unauthenticated
        // caller's logs. The host's own words carry no password.
        const detail = cause instanceof Error ? cause.message : String(cause);
        this.logger.warn(`A company mailbox poll failed: ${detail}`);
        errors.push(`A company mailbox could not be polled: ${detail}`);
      }
    });

    return { companiesPolled, messagesSeen, repliesRecorded, errors };
  }

  /** One company's poll. Runs already inside that company's tenant frame. */
  private async pollCompany(
    account: CompanyMailAccount,
  ): Promise<{ seen: number; recorded: number }> {
    if (!account.smtpHost || !account.smtpPassword) return { seen: 0, recorded: 0 };

    const config: InboundMailboxConfig = {
      host: imapHostFor(account.smtpHost),
      port: 993,
      secure: true,
      username: account.smtpUsername || account.fromAddress || '',
      password: decryptSmtpPassword(account.smtpPassword),
    };

    const cursor = await this.prisma.inboundMailCursor.findFirst();
    const sinceUid = cursor?.lastSeenUid ?? 0;

    const messages = await this.reader.fetchSince(config, sinceUid, MAX_MESSAGES_PER_POLL);

    let recorded = 0;
    let highestUid = sinceUid;
    for (const message of messages) {
      highestUid = Math.max(highestUid, message.uid);
      if (await this.recordReply(message)) recorded += 1;
    }

    await this.advanceCursor(cursor?.id, highestUid);
    return { seen: messages.length, recorded };
  }

  /**
   * Record one reply against the lead it answers, or decline to.
   *
   * Declines — rather than fails — on the two ordinary cases: a sender that matches no lead
   * (this does not invent one from a stranger), and a Message-ID already recorded (a re-poll,
   * which must be a no-op, not a second entry).
   */
  private async recordReply(message: InboundMessage): Promise<boolean> {
    if (!message.fromAddress) return false;

    const lead = await this.prisma.lead.findFirst({
      where: { email: { equals: message.fromAddress, mode: 'insensitive' } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, assignedToUserId: true },
    });
    if (!lead) return false;

    const already = await this.prisma.leadEmailReceipt.findFirst({
      where: { messageId: message.messageId },
      select: { id: true },
    });
    if (already) return false;

    // Stored and shown as text — the raw HTML never reaches here (the reader flattened it), and
    // only a preview is kept, the same shape a sent email's Timeline entry takes.
    const preview = message.text.trim().slice(0, PREVIEW_CHARS);

    const activity = await this.prisma.activity.create({
      data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
        type: 'email',
        notes: `Reply received: ${message.subject}\n\n${preview}`,
        leadId: lead.id,
        occurredAt: message.receivedAt,
        createdByUserId: SYSTEM_ACTOR_ID,
        createdByName: SYSTEM_ACTOR_NAME,
      }),
    });

    try {
      await this.prisma.leadEmailReceipt.create({
        data: companyApplied<Prisma.LeadEmailReceiptUncheckedCreateInput>({
          leadId: lead.id,
          activityId: activity.id,
          messageId: message.messageId,
          fromAddress: message.fromAddress,
          subject: message.subject,
          receivedAt: message.receivedAt,
        }),
      });
    } catch (cause) {
      // Two overlapping polls raced past the `already` check and both wrote the activity; the
      // unique index caught the second receipt. Undo this run's duplicate so the Timeline shows
      // the reply once, and report it as not recorded rather than letting the conflict escape.
      if (isUniqueViolation(cause)) {
        await this.prisma.activity.deleteMany({ where: { id: activity.id } });
        return false;
      }
      throw cause;
    }

    if (lead.assignedToUserId) {
      await this.prisma.notification.create({
        data: companyApplied<Prisma.NotificationUncheckedCreateInput>({
          userId: lead.assignedToUserId,
          title: `${lead.name} replied`,
          message: `“${message.subject}” — a reply just came in. Open the lead to read it.`,
          read: false,
        }),
      });
    }

    return true;
  }

  private async advanceCursor(cursorId: string | undefined, uid: number): Promise<void> {
    if (cursorId) {
      await this.prisma.inboundMailCursor.updateMany({
        where: { id: cursorId },
        data: { lastSeenUid: uid, lastPolledAt: new Date() },
      });
      return;
    }

    await this.prisma.inboundMailCursor.create({
      data: companyApplied<Prisma.InboundMailCursorUncheckedCreateInput>({
        lastSeenUid: uid,
        lastPolledAt: new Date(),
      }),
    });
  }

  /**
   * The gate on a public route. Refuses when no secret is configured rather than running open —
   * an unauthenticated poller is a way to make the server dial mailboxes on a schedule — and
   * tells a missing secret apart from a wrong one, since those have different fixes.
   */
  private authorize(provided: string | undefined): void {
    const expected = process.env.INBOUND_POLL_SECRET;

    if (!expected) {
      throw new ApiException(
        MAILBOX_ERROR_CODES.pollUnauthorized,
        'The inbound-reply poll has no INBOUND_POLL_SECRET set, so it refuses every request ' +
          'rather than running open. Set it here and on the scheduler that calls this.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!secretMatches(provided, expected)) {
      throw new ApiException(
        MAILBOX_ERROR_CODES.pollUnauthorized,
        'The inbound-reply poll was called with a missing or incorrect x-poll-secret.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002'
  );
}
