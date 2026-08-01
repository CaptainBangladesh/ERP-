import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionAuthority } from '../../platform/auth';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { sessionSecret } from './session.config';

/**
 * Identity and access — the first Core module, and the one that answers "who is this?" for
 * every other.
 *
 * It binds itself to the platform's `SessionAuthority` seam rather than being reached for
 * by name, which is what lets the guard protect every endpoint in the system without the
 * platform knowing this module exists. Everything else here is internal: no other module
 * injects `IdentityService`, and the manifest declares nothing that would let it.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      // Read at construction, so a deployment missing the secret fails at startup rather
      // than at the first sign-in attempt.
      useFactory: () => ({ secret: sessionSecret() }),
    }),
  ],
  controllers: [IdentityController],
  providers: [IdentityService, { provide: SessionAuthority, useExisting: IdentityService }],
  // The authority is the module's entire public surface. `IdentityService` itself is not
  // exported, so no other module can reach past the seam into how sign-in works.
  exports: [SessionAuthority],
})
export class IdentityModule {}
