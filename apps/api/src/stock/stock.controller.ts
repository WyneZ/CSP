import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { createReceiptSchema, createIssueSchema } from '@csp-erp/schemas';
import { Role } from '@csp-erp/db';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionUser } from '../common/session-user.decorator';
import { StockService } from './stock.service';

@Controller('stock')
@UseGuards(SessionAuthGuard, RolesGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('receipts')
  @Roles(Role.ADMIN, Role.STOREKEEPER)
  recordReceipt(@SessionUser() user: { tenantId: string; id: string }, @Body() body: unknown) {
    return this.stockService.recordReceipt(user.tenantId, user.id, createReceiptSchema.parse(body));
  }

  @Post('issues')
  @Roles(Role.ADMIN, Role.STOREKEEPER)
  recordIssue(@SessionUser() user: { tenantId: string; id: string }, @Body() body: unknown) {
    return this.stockService.recordIssue(user.tenantId, user.id, createIssueSchema.parse(body));
  }

  // Phase B backend prerequisite (2026-09-11): same-day undo, for both
  // RECEIPT and ISSUE movements -- dispatch on movementType happens inside
  // the service. Same roles as recording either movement type; the
  // per-record "only the original creator" restriction is enforced inside
  // StockService.undoMovement itself, with no Admin override (a separate,
  // not-yet-built "Fix a mistake" workflow is where that eventually lives).
  @Post('movements/:id/undo')
  @Roles(Role.ADMIN, Role.STOREKEEPER)
  undoMovement(@SessionUser() user: { tenantId: string; id: string }, @Param('id') id: string) {
    return this.stockService.undoMovement(user.tenantId, user.id, id);
  }

  @Get('current')
  getCurrentStock(
    @SessionUser() user: { tenantId: string },
    @Query('siteId') siteId?: string,
    @Query('materialId') materialId?: string,
  ) {
    return this.stockService.getCurrentStock(user.tenantId, siteId, materialId);
  }

  @Get('movements')
  getMovementHistory(
    @SessionUser() user: { tenantId: string },
    @Query('siteId') siteId?: string,
    @Query('materialId') materialId?: string,
  ) {
    return this.stockService.getMovementHistory(user.tenantId, siteId, materialId);
  }
}
