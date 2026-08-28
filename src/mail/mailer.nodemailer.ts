import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { Mailer } from './mailer';
import { EnvironmentVariables } from '../config/env.validation';

/**
 * The production binding for the `MAILER` token.
 *
 * Local development points at the Mailpit container from `docker-compose.yml`,
 * which accepts any message on 1025 and shows it on 8025. No credentials and no
 * TLS, because nothing leaves the machine.
 *
 * The reset mail carries the raw token. That value exists in exactly two places,
 * this message and the caller's inbox, because the row stores only its hash.
 * Nothing here is logged: the logging rule for this project names tokens among
 * the things that never reach a log line.
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
    this.transporter = createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.getOrThrow<number>('SMTP_PORT'),
      secure: false,
      ignoreTLS: true,
    });
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
        'Every device was signed out, so you must sign in again.',
        'If this was not you, reset your password now.',
      ].join('\n'),
    });
  }

  /**
   * A failed send must not undo work that already committed.
   *
   * Both callers change a password first and mail afterwards. Letting the send
   * throw would answer with an error for a request that succeeded, and the
   * caller would reasonably try again with a password that no longer works.
   */
  private async send(message: {
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (err) {
      this.logger.error(`Could not send "${message.subject}"`, err);
    }
  }
}
