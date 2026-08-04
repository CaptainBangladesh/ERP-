import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  MOVEMENTS_ROUTE,
  type MovementListResponse,
  type MovementResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { MovementsService } from './movements.service';
import { RecordMovementBody } from './schemas';

/**
 * The ledger, as an API.
 *
 * **There is no `PATCH` and no `DELETE`, and that is the module's central claim rather than an
 * omission.** A recorded movement is what happened; a movement that could be edited afterwards
 * would leave the accounting entries eventually derived from it with nothing to reconcile
 * against. The platform enforces it underneath as well — `StockMovement` is declared immutable
 * in `platform/tenancy/company-owned.ts`, so an `update` refuses at the query even if a route
 * for one were ever added by mistake. Two independent guarantees, because "append-only" held by
 * convention is append-only until somebody is in a hurry.
 *
 * **Receipts and issues are separate paths.** Receiving goods and issuing them are different
 * acts, done by different people, for different reasons, and the shape of the API says so. One
 * endpoint taking a direction would turn "did you mean to take this out?" into a validation
 * question, when it is a question the caller answered by choosing what to call.
 *
 * The acting user comes from `@CurrentSession()` and never from the body. A ledger that took
 * somebody's word for who they were would be a ledger where the one column an auditor cares
 * about is the one a client fills in.
 */
@Controller(MOVEMENTS_ROUTE)
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Post('receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory:movements:write')
  async recordReceipt(
    @CurrentSession() session: RequestSession,
    @Body(validated(RecordMovementBody)) body: Valid<typeof RecordMovementBody>,
  ): Promise<MovementResponse> {
    return this.movements.record('receipt', session.user, body);
  }

  @Post('issues')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory:movements:write')
  async recordIssue(
    @CurrentSession() session: RequestSession,
    @Body(validated(RecordMovementBody)) body: Valid<typeof RecordMovementBody>,
  ): Promise<MovementResponse> {
    return this.movements.record('issue', session.user, body);
  }

  /**
   * History. The list endpoint hands its whole query object to the service and names no
   * parameter of its own — `page`, `sort` and `filter.<field>` are the platform's convention,
   * identical in every module, which is what lets one table component drive this screen and the
   * thirty-nine others.
   */
  @Get()
  @RequirePermission('inventory:movements:read')
  async listMovements(@Query() query: Record<string, unknown>): Promise<MovementListResponse> {
    return this.movements.listMovements(query);
  }

  @Get(':id')
  @RequirePermission('inventory:movements:read')
  async movement(@Param('id') id: string): Promise<MovementResponse> {
    return this.movements.movementDetail(id);
  }
}
