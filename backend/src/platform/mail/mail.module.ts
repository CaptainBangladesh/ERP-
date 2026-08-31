import { Global, Module } from '@nestjs/common';
import { DevMailer } from './dev-mailer';
import { Mailer } from './mailer';
import { SmtpMailer } from './smtp-mailer';
import { DeploymentMailer } from './deployment-mailer';
import { UnconfiguredMailer } from './unconfigured-mailer';

/**
 * Global, like `TenancyModule`: every module that ever needs to send mail needs the same one
 * thing, and none of them should have to declare a dependency on the platform to get it.
 */
@Global()
@Module({
  providers: [
    DevMailer,
    SmtpMailer,
    UnconfiguredMailer,
    {
      /**
       * Which mailer, in order of what the environment can actually do:
       *
       *   test        — `DevMailer`, whose `sent` array is the inbox a suite reads a reset
       *                 link out of.
       *   SMTP set    — `SmtpMailer`, the only one that puts mail on the internet.
       *   production  — `UnconfiguredMailer`, which refuses. A deployment with no mail
       *                 configured must not report messages as sent; see that file.
       *   otherwise   — `DevMailer`, for a developer who has not set SMTP up and does not
       *                 need to.
       */
      provide: DeploymentMailer,
      useFactory: (
        devMailer: DevMailer,
        smtpMailer: SmtpMailer,
        unconfigured: UnconfiguredMailer,
      ) => {
        if (process.env.NODE_ENV === 'test') return devMailer;
        if (process.env.SMTP_HOST) return smtpMailer;
        if (process.env.NODE_ENV === 'production') return unconfigured;
        return devMailer;
      },
      inject: [DevMailer, SmtpMailer, UnconfiguredMailer],
    },
    {
      // What anything sending mail injects, unless a module has a better answer for its own
      // messages — identity does, and overrides `Mailer` inside itself. Everything else in
      // the system gets the deployment's mailer under this name and is none the wiser.
      provide: Mailer,
      useExisting: DeploymentMailer,
    },
  ],
  exports: [Mailer, DeploymentMailer, DevMailer, SmtpMailer],
})
export class MailModule {}
