import { Module } from '@nestjs/common';
import { PartiesModule } from '../parties';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * Crm.
 *
 * Imports `PartiesModule`, the declared dependency finally being used: what arrives is
 * `PartyDirectory` and not `PartiesService`, because that is all `PartiesModule` exports. So
 * `LeadsService` can resolve the Party a qualify request names, and cannot reach a parties
 * table, its merge logic, or create a `Party` row of its own — creating one is Parties' own
 * `POST /api/parties`, called by the frontend before it ever reaches here.
 *
 * Exports nothing yet. When another module needs something from this one, declare an
 * abstract class in `index.ts`, bind `LeadsService` to it here with `useExisting`, and export
 * *that* — never the service, so the contract cannot be widened by accident on the far side
 * of a `dependsOn` somebody added for a different reason.
 */
@Module({
  imports: [PartiesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class CrmModule {}
