import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  /** Content-ID for an inline image, referenced as cid:name in the HTML. */
  cid: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable per logical notification; lets receiving MTAs de-duplicate. */
  messageId?: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Verifies connectivity where supported (SMTP). */
  verify(): Promise<void>;
}

/** Production transport: SMTP via Nodemailer. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(private readonly env: Env) {
    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      ...(env.SMTP_CA_FILE && { tls: { ca: readFileSync(env.SMTP_CA_FILE) } }),
    });
    this.from = `"${env.EMAIL_FROM_NAME.replace(/"/g, '')}" <${env.EMAIL_FROM_ADDRESS}>`;
  }

  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      replyTo: this.env.EMAIL_REPLY_TO,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      messageId: m.messageId,
      attachments: m.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        cid: a.cid,
        contentDisposition: 'inline' as const,
      })),
    });
  }

  async verify(): Promise<void> {
    await this.transport.verify();
  }
}

/**
 * Development transport: writes each message as a .eml file under EMAIL_FILE_DIR
 * so it can be opened in any mail client. Rejected in production by env validation.
 */
export class FileMailer implements Mailer {
  private readonly transport = createTransport({ streamTransport: true, buffer: true });

  constructor(
    private readonly dir: string,
    private readonly from: string,
  ) {}

  async send(m: MailMessage): Promise<void> {
    const info = await this.transport.sendMail({ from: this.from, ...m });
    await fs.mkdir(this.dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.to.replace(/[^a-z0-9@._-]/gi, '_')}.eml`;
    await fs.writeFile(path.join(this.dir, name), info.message as Buffer);
  }

  async verify(): Promise<void> {}
}

/** In-memory transport for tests; can be told to fail to simulate SMTP outages. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failNext = 0;

  async send(m: MailMessage): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Simulated SMTP failure: 421 Service not available');
    }
    this.sent.push(m);
  }

  async verify(): Promise<void> {}
}

export function createMailer(env: Env): Mailer {
  if (env.EMAIL_TRANSPORT === 'smtp') return new SmtpMailer(env);
  return new FileMailer(
    path.resolve(env.EMAIL_FILE_DIR),
    `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM_ADDRESS}>`,
  );
}
