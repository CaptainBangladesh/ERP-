import { Module } from '@nestjs/common';
import { HrmController } from './hrm.controller';
import { HrmService } from './hrm.service';

/**
 * The HRM shape stub.
 *
 * Exports nothing. No other module reaches into it, and it reaches into no other — it does
 * not even depend on identity, because employees are its own record rather than a view of
 * identity's users. That independence is deliberate: a stub that needed a dependency to
 * demonstrate its shape would be demonstrating the dependency instead.
 */
@Module({
  controllers: [HrmController],
  providers: [HrmService],
})
export class HrmModule {}
