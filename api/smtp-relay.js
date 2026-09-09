import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Allow GET for quick health-check in browser or ping
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'ERP SMTP Relay',
      message: 'Vercel SMTP Relay is running and ready to deliver emails.',
      timestamp: new Date().toISOString(),
    });
  }

  // Only accept POST requests for email actions
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET.' });
  }

  // Verify authorization secret so only your backend can use this relay
  const relaySecret = process.env.SMTP_RELAY_SECRET || process.env.SESSION_SECRET;
  const providedSecret = req.headers['x-relay-secret'];
  if (relaySecret && providedSecret !== relaySecret) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing x-relay-secret' });
  }

  let body = req.body;
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
  const hasAuth = Boolean(smtp.user || smtp.username || smtp.pass || smtp.password);

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure ?? (port === 465),
    auth: hasAuth
      ? {
          user: smtp.user || smtp.username,
          pass: smtp.pass || smtp.password,
        }
      : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 25000,
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
    });

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      response: info.response,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(502).json({
      success: false,
      error: errorMsg,
    });
  } finally {
    transporter.close();
  }
}
