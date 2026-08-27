import { MAILER, Mailer } from './mailer';

/**
 * The two methods the auth and users services call.
 *
 * The list is short on purpose. A spec that calls a method which is not here
 * fails with a type error, instead of receiving `undefined` from a deep mock
 * and passing for the wrong reason. Add a method when a service needs one.
 */
export interface MailerMock {
  sendPasswordReset: jest.Mock;
  sendPasswordChanged: jest.Mock;
}

/**
 * Build a fresh mock. Call it in `beforeEach`, so no state crosses a test.
 *
 * Both methods resolve. A service that awaits the call therefore continues, and
 * the call arguments stay readable through `mock.calls`. A spec that compares
 * the mailed token against the stored one reads the first argument from there.
 */
export function createMailerMock(): MailerMock {
  return {
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Give the mock to a testing module where it wants the real mailer.
 *
 * The cast lives here, in one function, so no spec needs one. The provider uses
 * the `MAILER` token, because a TypeScript interface carries no runtime value
 * for Nest to resolve.
 */
export function mailerMockProvider(mock: MailerMock) {
  return { provide: MAILER, useValue: mock as unknown as Mailer };
}
