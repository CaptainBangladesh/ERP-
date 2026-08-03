import { Global, Module } from '@nestjs/common';
import { DevMailer } from './dev-mailer';
import { Mailer } from './mailer';

/**
 * Global, like `TenancyModule`: every module that ever needs to send mail needs the same one
 * thing, and none of them should have to declare a dependency on the platform to get it — the
 * platform is not a module and cannot be named in a manifest's `dependsOn`.
 */
@Global()
@Module({
  providers: [DevMailer, { provide: Mailer, useExisting: DevMailer }],
  exports: [Mailer, DevMailer],
})
export class MailModule {}
