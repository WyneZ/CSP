import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  approveRequisitionSchema,
  createRequisitionSchema,
  issueRequisitionSchema,
  rejectRequisitionSchema,
} from '@csp-erp/schemas';
import { Role } from '@csp-erp/db';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionUser } from '../common/session-user.decorator';
import { RequisitionsService } from './requisitions.service';

@Controller('requisitions')
@UseGuards(SessionAuthGuard, RolesGuard)
export class RequisitionsController {
  constructor(private readonly requisitionsService: RequisitionsService) {}

  @Get()
  findAll(@SessionUser() user: { tenantId: string }) {
    return this.requisitionsService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@SessionUser() user: { tenantId: string }, @Param('id') id: string) {
    return this.requisitionsService.findOne(user.tenantId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  create(@SessionUser() user: { tenantId: string; id: string }, @Body() body: unknown) {
    return this.requisitionsService.create(user.tenantId, user.id, createRequisitionSchema.parse(body));
  }

  @Post(':id/submit')
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  submit(@SessionUser() user: { tenantId: string; id: string }, @Param('id') id: string) {
    return this.requisitionsService.submit(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  cancel(@SessionUser() user: { tenantId: string; id: string }, @Param('id') id: string) {
    return this.requisitionsService.cancel(user.tenantId, user.id, id);
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN)
  approve(
    @SessionUser() user: { tenantId: string; id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.requisitionsService.approve(user.tenantId, user.id, id, approveRequisitionSchema.parse(body));
  }

  @Post(':id/reject')
  @Roles(Role.ADMIN)
  reject(
    @SessionUser() user: { tenantId: string; id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.requisitionsService.reject(user.tenantId, user.id, id, rejectRequisitionSchema.parse(body));
  }

  @Post(':id/issue')
  @Roles(Role.ADMIN, Role.STOREKEEPER)
  issue(
    @SessionUser() user: { tenantId: string; id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.requisitionsService.issue(user.tenantId, user.id, id, issueRequisitionSchema.parse(body));
  }
}
