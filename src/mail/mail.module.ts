import { Global, Module } from '@nestjs/common';
import { MAILER } from './mailer';
import { NodemailerMailer } from './mailer.nodemailer';

/**
 * `MAILER` is an injection token rather than a class, because `Mailer` is a
 * TypeScript interface and carries no runtime value for Nest to resolve.
 *
 * Global, because both `UsersService` and `AuthService` mail and neither should
 * have to import a module to send one message.
 */
@Global()
@Module({
  providers: [{ provide: MAILER, useClass: NodemailerMailer }],
  exports: [MAILER],
})
export class MailModule {}
