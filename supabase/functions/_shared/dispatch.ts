// Pluggable notification channels. v1 ships EmailChannel (Resend); the Channel
// interface lets Telegram/WhatsApp slot in later without touching the poller.
import type { EmailPayload } from './detectors.ts';

export interface Channel {
  send(to: string, payload: EmailPayload): Promise<void>;
}

export function buildResendBody(
  from: string,
  to: string,
  payload: EmailPayload,
): Record<string, unknown> {
  return { from, to: [to], subject: payload.subject, html: payload.html, text: payload.text };
}

export function appendUnsubscribe(payload: EmailPayload, url: string): EmailPayload {
  return {
    subject: payload.subject,
    text: `${payload.text}\n\n—\nUnsubscribe: ${url}`,
    html: `${payload.html}<hr/><p style="font-size:12px;color:#888">You get these because you enabled notifications. <a href="${url}">Unsubscribe</a>.</p>`,
  };
}

export class EmailChannel implements Channel {
  constructor(
    private apiKey: string,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, payload: EmailPayload): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildResendBody(this.from, to, payload)),
    });
    if (!res.ok) {
      throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
    }
  }
}
