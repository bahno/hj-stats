// Pluggable notification channels. v1 ships EmailChannel (Resend); the Channel
// interface lets Telegram/WhatsApp slot in later without touching the poller.
import type { EmailPayload } from './detectors.ts';
import { HttpError, withRetry } from './retry.ts';

export interface Channel {
  send(to: string, payload: EmailPayload): Promise<void>;
}

export function buildResendBody(
  from: string,
  to: string,
  payload: EmailPayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from,
    to: [to],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  };
  // RFC 8058: let the mail client offer its own one-click unsubscribe, which it
  // sends as a POST — matching what notify-unsubscribe accepts.
  if (payload.unsubscribeUrl) {
    body.headers = {
      'List-Unsubscribe': `<${payload.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  return body;
}

export function appendUnsubscribe(payload: EmailPayload, url: string): EmailPayload {
  return {
    subject: payload.subject,
    text: `${payload.text}\n\n—\nUnsubscribe: ${url}`,
    html: `${payload.html}<hr/><p style="font-size:12px;color:#888">You get these because you enabled notifications. <a href="${url}">Unsubscribe</a>.</p>`,
    unsubscribeUrl: url,
  };
}

/** A hung Resend request would stall the whole poller run; cap it. */
const SEND_TIMEOUT_MS = 15_000;

export class EmailChannel implements Channel {
  constructor(
    private apiKey: string,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, payload: EmailPayload): Promise<void> {
    // Retried on 429/5xx only. A 4xx here (bad key, unverified sender, sandbox
    // recipient restriction) is a configuration fault that repeating won't fix,
    // and it must surface in notification_deliveries.error rather than being
    // buried under retries. The outbox handles the longer-term retry anyway.
    await withRetry(async () => {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildResendBody(this.from, to, payload)),
      });
      if (!res.ok) {
        // Keep Resend's own message: it is what lands in the delivery log.
        throw new HttpError(res.status, `Resend HTTP ${res.status}: ${await res.text()}`);
      }
    });
  }
}
