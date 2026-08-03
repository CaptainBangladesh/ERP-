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
  controllers: [IdentityController, UsersController, RolesController],
  providers: [
    IdentityService,
    RecoveryService,
    RolesService,
    SessionIssuer,
    UsersService,
    { provide: SessionAuthority, useExisting: IdentityService },
  ],
  // The authority is the module's entire public surface. Nothing here is exported by name.
  exports: [SessionAuthority],
})
export class IdentityModule {}
