import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@csp-erp/db';
import type { CreateSiteInput, UpdateSiteInput } from '@csp-erp/schemas';

@Injectable()
export class SitesService {
  findAll(tenantId: string) {
    return prisma.site.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async findOne(tenantId: string, id: string) {
    const site = await prisma.site.findFirst({ where: { id, tenantId } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  create(tenantId: string, userId: string, input: CreateSiteInput) {
    return prisma.site.create({
      data: { ...input, tenantId, createdById: userId, updatedById: userId },
    });
  }

  async update(tenantId: string, userId: string, id: string, input: UpdateSiteInput) {
    await this.findOne(tenantId, id);
    return prisma.site.update({
      where: { id },
      data: { ...input, updatedById: userId },
    });
  }
}
