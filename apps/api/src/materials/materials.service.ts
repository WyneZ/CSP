import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@csp-erp/db';
import type { CreateMaterialInput, UpdateMaterialInput } from '@csp-erp/schemas';

@Injectable()
export class MaterialsService {
  findAll(tenantId: string) {
    return prisma.material.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async findOne(tenantId: string, id: string) {
    const material = await prisma.material.findFirst({ where: { id, tenantId } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  create(tenantId: string, userId: string, input: CreateMaterialInput) {
    return prisma.material.create({
      data: { ...input, tenantId, createdById: userId, updatedById: userId },
    });
  }

  async update(tenantId: string, userId: string, id: string, input: UpdateMaterialInput) {
    await this.findOne(tenantId, id);
    return prisma.material.update({
      where: { id },
      data: { ...input, updatedById: userId },
    });
  }
}
