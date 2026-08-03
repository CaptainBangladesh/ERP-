import { Module } from '@nestjs/common';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { PartyDirectory } from './party-directory';

/**
 * Parties — one address book for the whole system.
 *
 * Exports `PartyDirectory` and binds the service to it. `PartiesService` itself is not
 * exported, so a module that declares `dependsOn: ['parties']` gets the contract and not the
 * implementation: it can read a party and it cannot reach the tables, the merge logic, or
 * the validation, which are free to change without forty modules changing with them.
 *
 * `useExisting` rather than `useClass`, so the controller and the directory are the same
 * instance. Two would be two caches, two transactions' worth of state, and eventually two
 * answers.
 */
@Module({
  controllers: [PartiesController],
  providers: [PartiesService, { provide: PartyDirectory, useExisting: PartiesService }],
  exports: [PartyDirectory],
})
export class PartiesModule {}
