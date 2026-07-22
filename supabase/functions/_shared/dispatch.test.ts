import { describe, it, expect } from 'vitest';
import { buildResendBody, appendUnsubscribe } from './dispatch';

describe('buildResendBody', () => {
  it('maps payload to the Resend API shape', () => {
    const body = buildResendBody('HJ <no-reply@hj.dev>', 'u@x.com', {
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
    });
    expect(body).toEqual({
      from: 'HJ <no-reply@hj.dev>',
      to: ['u@x.com'],
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
    });
  });
});

describe('buildResendBody — one-click unsubscribe', () => {
  it('emits RFC 8058 headers when the payload carries an unsubscribe URL', () => {
    const payload = appendUnsubscribe(
      { subject: 'S', html: '<p>h</p>', text: 't' },
      'https://x/u?token=abc',
    );
    const body = buildResendBody('HJ <no-reply@hj.dev>', 'u@x.com', payload);
    expect(body.headers).toEqual({
      'List-Unsubscribe': '<https://x/u?token=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('omits the headers entirely when there is no unsubscribe URL', () => {
    const body = buildResendBody('HJ <no-reply@hj.dev>', 'u@x.com', {
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
    });
    expect(body.headers).toBeUndefined();
  });
});

describe('appendUnsubscribe', () => {
  it('adds the unsubscribe link to html and text', () => {
    const out = appendUnsubscribe({ subject: 'S', html: '<p>h</p>', text: 't' }, 'https://x/u?token=abc');
    expect(out.text).toContain('https://x/u?token=abc');
    expect(out.html).toContain('https://x/u?token=abc');
    expect(out.html).toContain('Unsubscribe');
    expect(out.unsubscribeUrl).toBe('https://x/u?token=abc');
  });
});
