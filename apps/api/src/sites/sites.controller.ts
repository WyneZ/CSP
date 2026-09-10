import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { createSiteSchema, updateSiteSchema } from '@csp-erp/schemas';
import { Role } from '@csp-erp/db';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionUser } from '../common/session-user.decorator';
import { SitesService } from './sites.service';

@Controller('sites')
@UseGuards(SessionAuthGuard, RolesGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  findAll(@SessionUser() user: { tenantId: string }) {
    return this.sitesService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@SessionUser() user: { tenantId: string }, @Param('id') id: string) {
    return this.sitesService.findOne(user.tenantId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  create(
    @SessionUser() user: { tenantId: string; id: string },
    @Body() body: unknown,
  ) {
    return this.sitesService.create(user.tenantId, user.id, createSiteSchema.parse(body));
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  update(
    @SessionUser() user: { tenantId: string; id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.sitesService.update(user.tenantId, user.id, id, updateSiteSchema.parse(body));
  }
}
