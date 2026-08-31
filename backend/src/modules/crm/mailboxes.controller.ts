import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Header,
} from '@nestjs/common';
import {
  CRM_ROUTE,
  type ConnectMailboxUrlResponse,
  type MailboxConnectionListResponse,
  type MailboxConnectionSummary,
  type MailboxProvider,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { CurrentSession, Public, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { MailboxesService } from './mailboxes.service';
import { ConnectSmtpMailboxBody, CreateConnectUrlBody } from './schemas';

@Controller(CRM_ROUTE)
export class MailboxesController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  @Post('mailboxes/connect-url')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:read')
  async createConnectUrl(
    @CurrentSession() session: RequestSession,
    @Body(validated(CreateConnectUrlBody)) body: Valid<typeof CreateConnectUrlBody>,
  ): Promise<ConnectMailboxUrlResponse> {
    return this.mailboxesService.createConnectUrl(body.provider as MailboxProvider, {
      userId: session.user.id,
    });
  }

  /**
   * Where Google returns a mailbox connection — a popup the user opened from inside the
   * application, so what comes back is a page that reports to its opener and closes itself.
   *
   * The HTML is *returned*, with the content type declared, rather than written to the
   * response object: taking the response would put this handler outside `ApiExceptionFilter`,
   * which is the one place every failure in the system is given its shape.
   *
   * A failure is caught and rendered rather than thrown, and that is the one place in this
   * flow where swallowing is right: nothing is listening for a JSON error, because the tab
   * this answers is a popup a person is looking at. What it must not do — and used to — is
   * say "Connected Successfully!" regardless. The message it shows and the message it posts
   * to its opener now both follow what actually happened.
   */
  @Public()
  @Get('mailboxes/callback')
  @Header('Content-Type', 'text/html')
  async handleCallback(@Query() query: Record<string, unknown>): Promise<string> {
    const state = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : '';

    // Google reports a consent screen the user dismissed as `error` and no code at all.
    if (!state || !code) {
      return popupResult(false, 'Connection cancelled. Nothing was connected.');
    }

    try {
      await this.mailboxesService.handleOAuthCallback(state, code);
      return popupResult(true, 'Mailbox connected.');
    } catch (cause) {
      const message =
        cause instanceof ApiException
          ? cause.message
          : 'Something went wrong connecting this mailbox. Nothing was connected.';
      return popupResult(false, message);
    }
  }

  @Get('mailboxes')
  @RequirePermission('crm:leads:read')
  async listMailboxes(
    @CurrentSession() session: RequestSession,
  ): Promise<MailboxConnectionListResponse> {
    const items = await this.mailboxesService.listMailboxes(session.user.id);
    return { items };
  }

  /**
   * Adds a company mailbox by its SMTP details — the other way to get a mailbox, alongside
   * consenting at an OAuth provider.
   *
   * A plain guarded POST rather than a redirect dance, because there is no third party in
   * this one: the credentials come straight from the person who owns them.
   */
  @Post('mailboxes/smtp')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:read')
  async connectSmtpMailbox(
    @CurrentSession() session: RequestSession,
    @Body(validated(ConnectSmtpMailboxBody)) body: Valid<typeof ConnectSmtpMailboxBody>,
  ): Promise<MailboxConnectionSummary> {
    return this.mailboxesService.connectSmtp(body, { userId: session.user.id });
  }

  /**
   * Removes the connection. `DELETE` because it deletes — the screen's "Remove" used to post
   * to the revoke endpoint, so pressing it on an already-revoked mailbox changed nothing and
   * the row stayed on the list forever.
   */
  @Delete('mailboxes/:id')
  @RequirePermission('crm:leads:read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMailbox(@Param('id') id: string): Promise<void> {
    await this.mailboxesService.removeMailbox(id);
  }

  @Post('mailboxes/:id/revoke')
  @RequirePermission('crm:leads:read')
  @HttpCode(HttpStatus.OK)
  async disconnectMailbox(
    @Param('id') id: string,
  ): Promise<MailboxConnectionSummary> {
    return this.mailboxesService.disconnectMailbox(id);
  }
}

/**
 * The page a mailbox popup ends on: what happened, posted to the opener and shown to whoever
 * is looking at it.
 *
 * `connected` rides on the message rather than being implied by its arrival, so the modal can
 * tell a connection from a refusal — it used to receive the same event either way and refresh
 * its list hoping for the best.
 */
function popupResult(connected: boolean, message: string): string {
  const escaped = message.replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]!);

  return `<!DOCTYPE html>
<html>
<head><title>${connected ? 'Mailbox connected' : 'Mailbox not connected'}</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#fff;">
  <h2>${connected ? 'Connected' : 'Not connected'}</h2>
  <p>${escaped}</p>
  <script>
    if (window.opener) {
      window.opener.postMessage(
        { type: 'MAILBOX_CONNECTION_RESULT', connected: ${connected}, message: ${JSON.stringify(message)} },
        window.location.origin,
      );
    }
    setTimeout(function () {
      try { window.close(); } catch (e) {}
    }, ${connected ? 800 : 2500});
  </script>
</body>
</html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
