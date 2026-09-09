/**
 * Whether Resend will actually accept mail *from this address*, asked before the settings are
 * believed rather than at the moment a send fails.
 *
 * Resend refuses any `from` on a domain that has not been verified in the account, answering
 * a 403 at send time. Checking only that the API key works — which is what this used to do —
 * proves the key and nothing about the sender, so a company whose address is on an unverified
 * domain got a screen saying mail was configured and a refusal on the first real send. The
 * two failures are days apart and read nothing alike, which is the worst possible arrangement
 * for whoever has to fix it.
 *
 * Answers a sentence describing the problem, or `undefined` when the address is sendable.
 */
export async function describeResendSenderProblem(
  apiKey: string,
  fromAddress: string,
): Promise<string | undefined> {
  const domain = fromAddress.split('@')[1]?.toLowerCase().trim();
  if (!domain) return `“${fromAddress}” is not a valid email address.`;

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    return `Could not reach Resend to check the sender domain: ${
      cause instanceof Error ? cause.message : String(cause)
    }`;
  }

  if (response.status === 401 || response.status === 403) {
    return `Resend rejected the API key (HTTP ${response.status}). Check RESEND_API_KEY.`;
  }

  if (!response.ok) {
    return `Resend could not list verified domains (HTTP ${response.status}).`;
  }

  const body = (await response.json().catch(() => ({}))) as {
    data?: { name?: string; status?: string }[];
  };
  const domains = body.data ?? [];
  const match = domains.find((entry) => entry.name?.toLowerCase() === domain);

  if (!match) {
    return (
      `Resend has no verified domain for “${domain}”, so it will refuse mail from ` +
      `${fromAddress}. Add and verify ${domain} in the Resend dashboard, or send through an ` +
      'SMTP relay instead (set SMTP_RELAY_URL).'
    );
  }

  if (match.status && match.status !== 'verified') {
    return (
      `The domain “${domain}” is registered with Resend but its status is “${match.status}”, ` +
      'so mail from it will be refused until verification completes.'
    );
  }

  return undefined;
}
