import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { createVendorSchema, updateVendorSchema } from '@csp-erp/schemas';
import { Role } from '@csp-erp/db';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionUser } from '../common/session-user.decorator';
import { VendorsService } from './vendors.service';

@Controller('vendors')
@UseGuards(SessionAuthGuard, RolesGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  findAll(@SessionUser() user: { tenantId: string }) {
    return this.vendorsService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@SessionUser() user: { tenantId: string }, @Param('id') id: string) {
    return this.vendorsService.findOne(user.tenantId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  create(@SessionUser() user: { tenantId: string; id: string }, @Body() body: unknown) {
    return this.vendorsService.create(user.tenantId, user.id, createVendorSchema.parse(body));
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  update(
    @SessionUser() user: { tenantId: string; id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.vendorsService.update(user.tenantId, user.id, id, updateVendorSchema.parse(body));
  }
}
