import { Global, Module } from '@nestjs/common';
import { DevMailer } from './dev-mailer';
import { Mailer } from './mailer';
import { SmtpMailer } from './smtp-mailer';

/**
 * Global, like `TenancyModule`: every module that ever needs to send mail needs the same one
 * thing, and none of them should have to declare a dependency on the platform to get it.
 */
@Global()
@Module({
  providers: [
    DevMailer,
    SmtpMailer,
    {
      provide: Mailer,
      useFactory: (devMailer: DevMailer, smtpMailer: SmtpMailer) => {
        if (process.env.NODE_ENV !== 'test' && process.env.SMTP_HOST) {
          return smtpMailer;
        }
        return devMailer;
      },
      inject: [DevMailer, SmtpMailer],
    },
  ],
  exports: [Mailer, DevMailer, SmtpMailer],
})
export class MailModule {}
