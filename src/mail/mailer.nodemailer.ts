import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { LowStockMail, Mailer } from './mailer';
import { EnvironmentVariables } from '../config/env.validation';

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
    // **`ignoreTLS` used to be hard coded here, and it does more than allow a
    // plaintext connection: it refuses STARTTLS even when the relay offers it.**
    // So a server willing to encrypt was talked to in the clear anyway, and the
    // reset message carries a raw bearer credential for the account. There was
    // also no `SMTP_USER` or `SMTP_PASS` in the schema, so **no configuration
    // path to an authenticated relay existed at all**: the only deployment this
    // class could reach was an open one.
    //
    // The default is still plaintext because Mailpit is what `docker-compose`
    // runs and it speaks no TLS. What changed is that a deployment can now say
    // otherwise. `secure` is implicit TLS and belongs to port 465. A 587 relay
    // upgrades with STARTTLS, which nodemailer does on its own when the relay
    // offers it, and `requireTLS` is what turns a relay that does not offer it
    // into a failed send rather than a plaintext one. `env.validation.ts` says
    // which to set where.
    //
    // `user !== undefined` is safe only because `ConfigModule` runs with
    // `skipProcessEnv`. Without it a pair the shell exported empty arrived
    // here as `''` and became a request to authenticate with no credentials.
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
   * The low-stock mail, with the product's image when there is one.
   *
   * The one method here that throws. The caller is a queue job, the job's
   * attempts are the retry, and a send that failed quietly would count as
   * done. So this calls `deliver` and not `send`, and the processor deletes
   * the row it wrote when this rejects.
   *
   * The name is escaped because a manager typed it, and the image is a plain
   * `img` so a client that blocks remote images still shows the text.
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
   * A failed send is logged and never thrown, and the two callers need that for
   * two different reasons.
   *
   * **The changed-password mail.** The password already changed and the
   * transaction committed. Throwing would answer with an error for a request
   * that succeeded, and the caller would reasonably retry with a password that
   * no longer works. This is the case the previous version of this comment
   * described, and it described it as though it covered both callers.
   *
   * **The reset mail, which it does not cover.** There the message *is* the
   * deliverable: with SMTP down, `requestPasswordReset` has written the token
   * hash and its expiry, answers 202, and nobody receives anything. Swallowing
   * that is worse, and it is still right, because **the 202 is unconditional on
   * purpose**. Answering 500 when the send fails would answer 500 for a
   * registered address and 202 for an unknown one, which rebuilds exactly the
   * enumeration oracle the unconditional 202 exists to close, and it would
   * rebuild it on the route this repository already hardened twice.
   *
   * So the caller cannot be told and the operator has to be. The error log is
   * the only signal, and that is thin: **the durable answer is the queue**, one
   * job per recipient with a failed set whose size is the alert, which is what
   * `ARCHITECTURE.md` describes and nothing has built. Until then, a send
   * failure is a line in a log somebody has to be watching.
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
