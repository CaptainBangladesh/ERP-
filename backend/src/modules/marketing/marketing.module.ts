import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

/**
 * Marketing.
 *
 * Exports nothing. When another module needs something from this one, declare an abstract
 * class in 'index.ts', bind the service to it here with 'useExisting', and export *that* —
 * never the service, so the contract cannot be widened by accident on the far side of a
 * 'dependsOn' somebody added for a different reason. Export this module from 'index.ts' too,
 * because a consumer has to import it in order to inject what it provides.
 * 'backend/src/modules/parties' is the worked example.
 */
@Module({
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
