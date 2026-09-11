import { timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';

/**
 * The HTTPS door in front of SMTP, so a host that blocks outbound SMTP can still send mail.
 *
 * Render blocks outbound traffic on ports 25, 465 and 587 for free web services, so the API
 * cannot open a socket to a mail host at all — the connection does not get refused, it hangs
 * until it times out. Nothing in the application is wrong when that happens, and no amount of
 * correcting the mailbox password fixes it. This function runs somewhere that *can* open that
 * socket, and the API reaches it over ordinary HTTPS on 443, which nobody blocks.
 *
 * It holds no credentials of its own. The API sends the mailbox's own host, username and
 * password with each request and this opens exactly that connection — which is what keeps
 * "the mail came from the company's own account" true rather than becoming "the mail came
 * from whatever account the relay was configured with".
 *
 * `.mjs` rather than `.js` on purpose: this file is ESM, the repository root `package.json`
 * declares no `"type"`, and a `.js` file there is CommonJS unless the runtime happens to
 * sniff the syntax. The extension states it outright instead of depending on which Node
 * version the host runs.
 */

/** Long enough for a slow mail host, short enough that the platform does not kill it first. */
const CONNECTION_TIMEOUT_MS = 12_000;
const GREETING_TIMEOUT_MS = 8_000;
const SOCKET_TIMEOUT_MS = 20_000;

export default async function handler(req, res) {
  // A health check, so "is the relay deployed and reachable" is answerable from a browser and
  // from the API's own diagnostics without sending anything.
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'ERP SMTP Relay',
      secretConfigured: Boolean(relaySecret()),
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET.' });
  }

  /**
   * Refused outright when no secret is configured, rather than left open.
   *
   * Without this check an unset variable turns a private relay into one anybody who finds the
   * URL can drive: they supply their own mail credentials and this sends whatever they like
   * from a machine billed to whoever deployed it. "Unconfigured" must fail closed — an open
   * relay is worse than a broken one, because nothing about it looks broken.
   */
  const secret = relaySecret();
  if (!secret) {
    return res.status(503).json({
      error:
        'This relay has no SMTP_RELAY_SECRET set, so it refuses every request. Set the same ' +
        'value here and on the API.',
    });
  }

  if (!secretMatches(req.headers['x-relay-secret'], secret)) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing x-relay-secret' });
  }

  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Malformed JSON payload' });
    }
  }

  const { smtp, message, action } = body || {};

  if (!smtp || !smtp.host) {
    return res.status(400).json({ error: 'Missing SMTP host in payload' });
  }

  const port = Number(smtp.port) || 465;
  const user = smtp.user || smtp.username;
  const pass = smtp.pass || smtp.password;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure ?? port === 465,
    auth: user || pass ? { user, pass } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  try {
    if (action === 'verify') {
      await transporter.verify();
      return res.status(200).json({ success: true, verified: true });
    }

    if (!message || !message.to) {
      return res.status(400).json({ error: 'Missing recipient in message payload' });
    }

    const info = await transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
      html: message.html || (message.body ? message.body.replace(/\n/g, '<br/>') : undefined),
      // Threading headers, when the API sent them: a reply carries the original's Message-ID so
      // the recipient's client threads it under the message it answers.
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references ? { references: message.references } : {}),
    });

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      response: info.response,
    });
  } catch (error) {
    // The mail host's own code travels back with the message. Without it the API cannot tell
    // a wrong password from a host it could not reach, and those two have different fixes —
    // one is the user's, the other is the relay operator's.
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      code: typeof error?.code === 'string' ? error.code : undefined,
      responseCode: typeof error?.responseCode === 'number' ? error.responseCode : undefined,
    });
  } finally {
    transporter.close();
  }
}

function relaySecret() {
  return process.env.SMTP_RELAY_SECRET || process.env.SESSION_SECRET || '';
}

/**
 * Compared in constant time, so the comparison itself does not leak the secret one character
 * at a time to somebody willing to time a few thousand requests.
 */
function secretMatches(provided, expected) {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
