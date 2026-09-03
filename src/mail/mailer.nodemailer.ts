import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createTransport, Transporter } from 'nodemailer';
import { LowStockMail, Mailer } from './mailer';
import {
  EnvironmentVariables,
  type MailTransport,
} from '../config/env.validation';

/** The five characters HTML reads as markup, for a name a manager typed. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The production binding for `MAILER`. The reset mail carries the raw token,
 * which exists only in this message and the inbox, so nothing here is logged.
 */
@Injectable()
export class NodemailerMailer implements Mailer {
  private readonly logger = new Logger(NodemailerMailer.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {
    // `secure`, `requireTLS` and the credentials come from the environment,
    // and `env.validation.ts` says which to set where. `user !== undefined`
    // holds because `ConfigModule` runs with `skipProcessEnv`. The SES branch
    // builds the same MIME and hands it to `SendEmail` with the task role's
    // credentials. ADR 32.
    if (this.config.get<MailTransport>('MAIL_TRANSPORT') === 'ses') {
      this.transporter = createTransport({
        SES: {
          sesClient: new SESv2Client({
            region: this.config.getOrThrow<string>('AWS_REGION'),
          }),
          SendEmailCommand,
        },
      });
    } else {
      const secure = this.config.get<boolean>('SMTP_SECURE');
      const requireTLS = this.config.get<boolean>('SMTP_REQUIRE_TLS');
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');

      this.transporter = createTransport({
        host: this.config.getOrThrow<string>('SMTP_HOST'),
        port: this.config.getOrThrow<number>('SMTP_PORT'),
        secure,
        requireTLS,
        ...(user !== undefined && pass !== undefined
          ? { auth: { user, pass } }
          : {}),
      });
    }
    this.from = this.config.getOrThrow<string>('MAIL_FROM');
    this.appUrl = this.config.getOrThrow<string>('APP_URL');
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Reset your password',
      text: [
        'Somebody asked to reset the password for this account.',
        '',
        `Open this link to choose a new password: ${link}`,
        '',
        'The link works one time only, and it expires.',
        'If you did not ask for this, ignore this message. Your password does not change.',
      ].join('\n'),
    });
  }

  async sendPasswordChanged(to: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your password changed',
      text: [
        'The password for this account changed.',
        '',
        'Every device was signed out. Sign in again on each of them.',
        'If this was not you, reset your password now.',
      ].join('\n'),
    });
  }

  /**
   * The low-stock mail, with the product's image. The one method that throws:
   * the job's attempts are the retry. The name is escaped because a manager
   * typed it, and the text body carries the image URL too. ADR 28.
   */
  async sendLowStock(to: string, mail: LowStockMail): Promise<void> {
    const options = [mail.size, mail.color].filter((o) => o !== '').join(' ');
    const name =
      options === '' ? mail.productName : `${mail.productName}, ${options}`;
    const units = mail.stock === 1 ? 'unit' : 'units';
    const link = `${this.appUrl}/products/${mail.productId}`;

    await this.deliver({
      to,
      subject: `Only ${mail.stock} left: ${name}`,
      text: [
        `${name} is down to ${mail.stock} ${units}.`,
        '',
        `You liked it. If you want it, it is here: ${link}`,
        ...(mail.imageUrl === undefined ? [] : ['', mail.imageUrl]),
      ].join('\n'),
      html: [
        `<p>${escapeHtml(name)} is down to ${mail.stock} ${units}.</p>`,
        ...(mail.imageUrl === undefined
          ? []
          : [
              `<p><img src="${escapeHtml(mail.imageUrl)}" alt="${escapeHtml(mail.productName)}"></p>`,
            ]),
        `<p>You liked it. If you want it, it is here: <a href="${link}">${link}</a></p>`,
      ].join('\n'),
    });
  }

  /**
   * A failed send is logged and never thrown. The changed-password mail
   * follows a committed transaction, and the reset request must answer 202
   * either way, or a 500 on failure would say which addresses are registered.
   * README's Known gaps names it.
   */
  private async send(message: OutgoingMessage): Promise<void> {
    try {
      await this.deliver(message);
    } catch (err) {
      this.logger.error(`Could not send "${message.subject}"`, err);
    }
  }

  /** The send itself, which rejects the way the transport does. */
  private async deliver(message: OutgoingMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
