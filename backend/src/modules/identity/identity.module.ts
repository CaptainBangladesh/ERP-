import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionAuthority } from '../../platform/auth';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { RecoveryService } from './recovery.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SessionIssuer } from './session-issuer';
import { sessionSecret } from './session.config';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CompanyMailController } from './company-mail.controller';
import { CompanyMailService } from './company-mail.service';
import { MailHostVerifier, SmtpMailHostVerifier, StubMailHostVerifier } from './mail-host-verifier';
import { CompanyMailer } from './company-mailer';
import { DeploymentMailer, Mailer } from '../../platform/mail';

/**
 * Identity and access — the first Core module, and the one that answers "who is this?" for
 * every other, now with roles, colleague management, and account recovery alongside it.
 *
 * It binds itself to the platform's `SessionAuthority` seam rather than being reached for
 * by name, which is what lets the guard protect every endpoint in the system without the
 * platform knowing this module exists. Everything else here is internal: no other module
 * injects any of these services, and the manifest declares nothing that would let it.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      // Read at construction, so a deployment missing the secret fails at startup rather
      // than at the first sign-in attempt.
      useFactory: () => ({ secret: sessionSecret() }),
    }),
  ],
  controllers: [IdentityController, UsersController, RolesController, CompanyMailController],
  providers: [
    IdentityService,
    RecoveryService,
    RolesService,
    SessionIssuer,
    UsersService,
    CompanyMailService,
    SmtpMailHostVerifier,
    StubMailHostVerifier,
    {
      // The real verifier everywhere but the suite, which has no mail host to reach.
      provide: MailHostVerifier,
      useFactory: (live: SmtpMailHostVerifier, stub: StubMailHostVerifier) =>
        process.env.NODE_ENV === 'test' ? stub : live,
      inject: [SmtpMailHostVerifier, StubMailHostVerifier],
    },
    { provide: SessionAuthority, useExisting: IdentityService },
    {
      /**
       * Inside this module, `Mailer` means "send as this company when it has said how".
       *
       * The platform's own mailer is still underneath as the fallback, resolved here by
       * class so the wrapper can hold it — which is what lets `UsersService` and
       * `RecoveryService` go on injecting `Mailer` and know nothing about any of this.
       */
      provide: Mailer,
      useFactory: (settings: CompanyMailService, deploymentMailer: Mailer) =>
        new CompanyMailer(settings, deploymentMailer),
      inject: [CompanyMailService, DeploymentMailer],
    },
  ],
  // The authority is the module's entire public surface. Nothing here is exported by name.
  exports: [SessionAuthority],
})
export class IdentityModule {}
