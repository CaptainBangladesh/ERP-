import { Global, Module } from '@nestjs/common';
import { CompanyDirectory } from './company-directory';
import { CompanyRecord } from './company-record';

/**
 * Global, like `TenancyModule` and `MailModule`, and for the same reason: the tenant root is
 * not something a module should have to declare a dependency on the platform to read.
 *
 * Bound here rather than by identity, even though identity administers these columns. A
 * business module binding it would mean any module that read the company could not boot
 * without that module present — and the deletion test says the application boots with any
 * subset of modules. The platform owns the tenant root already; this is where it says so.
 */
@Global()
@Module({
  providers: [CompanyRecord, { provide: CompanyDirectory, useExisting: CompanyRecord }],
  exports: [CompanyDirectory],
})
export class CompanyModule {}
