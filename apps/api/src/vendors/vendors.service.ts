import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@csp-erp/db';
import type { CreateVendorInput, UpdateVendorInput } from '@csp-erp/schemas';

@Injectable()
export class VendorsService {
  findAll(tenantId: string) {
    return prisma.vendor.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async findOne(tenantId: string, id: string) {
    const vendor = await prisma.vendor.findFirst({ where: { id, tenantId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  create(tenantId: string, userId: string, input: CreateVendorInput) {
    return prisma.vendor.create({
      data: { ...input, tenantId, createdById: userId, updatedById: userId },
    });
  }

  async update(tenantId: string, userId: string, id: string, input: UpdateVendorInput) {
    await this.findOne(tenantId, id);
    return prisma.vendor.update({
      where: { id },
      data: { ...input, updatedById: userId },
    });
  }
}
