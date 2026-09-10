import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { createMaterialSchema, updateMaterialSchema } from '@csp-erp/schemas';
import { Role } from '@csp-erp/db';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionUser } from '../common/session-user.decorator';
import { MaterialsService } from './materials.service';

@Controller('materials')
@UseGuards(SessionAuthGuard, RolesGuard)
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  findAll(@SessionUser() user: { tenantId: string }) {
    return this.materialsService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@SessionUser() user: { tenantId: string }, @Param('id') id: string) {
    return this.materialsService.findOne(user.tenantId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  create(@SessionUser() user: { tenantId: string; id: string }, @Body() body: unknown) {
    return this.materialsService.create(user.tenantId, user.id, createMaterialSchema.parse(body));
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SITE_ENGINEER)
  update(
    @SessionUser() user: { tenantId: string; id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.materialsService.update(user.tenantId, user.id, id, updateMaterialSchema.parse(body));
  }
}
