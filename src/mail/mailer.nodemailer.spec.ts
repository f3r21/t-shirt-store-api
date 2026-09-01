import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { NodemailerMailer } from './mailer.nodemailer';
import { EnvironmentVariables } from '../config/env.validation';

// `jest.spyOn` cannot reach this one: nodemailer's exports are non-configurable
// getters, so redefining `createTransport` throws before any assertion runs.
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransportMock = createTransport as jest.Mock;

/**
 * The production binding for the `MAILER` token, which had no spec at all.
 *
 * `mail.module.ts` binds this class unconditionally, with no branch on
 * `NODE_ENV`, so it is what runs anywhere this service is deployed. Every test
 * in the repository used the in-memory double instead, so two decisions went
 * unexamined: how the transport is built, and what happens when a send fails.
 *
 * The second one has no other reachable test. Both doubles always resolve, so
 * the `catch` in `send` was a branch nothing could enter.
 */
describe('NodemailerMailer', () => {
  const ENV: Record<string, unknown> = {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    MAIL_FROM: 'no-reply@tshirt.store',
    APP_URL: 'http://localhost:3000',
  };

  function build(overrides: Record<string, unknown> = {}) {
    const values = { ...ENV, ...overrides };
    const config = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        if (values[key] === undefined) throw new Error(`missing ${key}`);
        return values[key];
      },
    } as unknown as ConfigService<EnvironmentVariables, true>;

    const sendMail = jest.fn().mockResolvedValue({});
    createTransportMock.mockClear();
    createTransportMock.mockReturnValue({ sendMail });

    const mailer = new NodemailerMailer(config);
    const [firstCall] = createTransportMock.mock.calls as unknown[][];
    return {
      mailer,
      sendMail,
      options: firstCall[0] as Record<string, unknown>,
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('the transport it builds', () => {
    /**
     * **`ignoreTLS` is gone, and its absence is the assertion.**
     *
     * The transport was hard coded with `secure: false, ignoreTLS: true`, which
     * refuses STARTTLS even from a relay that offers it, on the class that
     * sends a raw password reset token. Nothing asserted the options because
     * nothing built this class outside production.
     *
     * The second half is the control: the flag is read rather than pinned to
     * one value, so this stays red if `secure` is hard coded back to false.
     */
    it('never disables TLS, and follows SMTP_SECURE', () => {
      expect(build().options).toMatchObject({ secure: false });
      expect(build().options).not.toHaveProperty('ignoreTLS');

      expect(build({ SMTP_SECURE: true }).options).toMatchObject({
        secure: true,
      });
    });

    /**
     * There was no `SMTP_USER` or `SMTP_PASS` in the schema, so no configuration
     * path to an authenticated relay existed and the only deployment this class
     * could reach was an open one.
     *
     * Absent rather than empty when unset, because nodemailer reads an `auth`
     * object as a request to authenticate.
     */
    it('sends credentials only when both are configured', () => {
      expect(build().options).not.toHaveProperty('auth');
      expect(build({ SMTP_USER: 'apikey' }).options).not.toHaveProperty('auth');

      expect(
        build({ SMTP_USER: 'apikey', SMTP_PASS: 'secret' }).options,
      ).toMatchObject({ auth: { user: 'apikey', pass: 'secret' } });
    });
  });

  describe('when the relay is down', () => {
    /**
     * The branch no double could reach.
     *
     * Both mailer doubles always resolve, so nothing in the unit suite entered
     * the `catch`. It must not throw, because the caller has already committed
     * a password change or has answered an unconditional 202, and it must log,
     * because that line is the only signal a send failed at all.
     */
    it('logs and does not throw', async () => {
      const { mailer, sendMail } = build();
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        mailer.sendPasswordReset('ana@example.com', 'a-token'),
      ).resolves.toBeUndefined();

      expect(error).toHaveBeenCalled();
    });

    /**
     * The control. Without it the test above passes on a mailer that logs an
     * error on every send, successful or not.
     */
    it('logs no error when the send succeeds', async () => {
      const { mailer } = build();
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      await mailer.sendPasswordReset('ana@example.com', 'a-token');

      expect(error).not.toHaveBeenCalled();
    });

    /**
     * The token is a bearer credential for the account. It belongs in the
     * message and in the recipient's inbox, and nowhere else.
     */
    it('keeps the token out of the failure log', async () => {
      const { mailer, sendMail } = build();
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

      await mailer.sendPasswordReset('ana@example.com', 'the-secret-token');

      const logged = JSON.stringify(error.mock.calls);
      expect(logged).not.toContain('the-secret-token');
      expect(logged).not.toContain('ana@example.com');
    });
  });
});
