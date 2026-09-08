// Local dev bootstrap only. Creates the one tenant this v1 needs and a
// single admin user to log in with. Idempotent — safe to run more than
// once. Never run this against a real deployment; it prints a known
// password to the console on purpose.
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEV_TENANT_NAME = "Dev Contractor";
const DEV_ADMIN_EMAIL = "admin@dev.local";
const DEV_ADMIN_PASSWORD = "dev-password-123"; // local only — never a real credential

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000000" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000000",
      name: DEV_TENANT_NAME,
      defaultCurrency: "MMK",
    },
  });

  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: DEV_ADMIN_EMAIL } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Dev Admin",
      email: DEV_ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
    },
  });

  console.log("Seeded:");
  console.log(`  tenant: ${tenant.name} (${tenant.id})`);
  console.log(`  admin:  ${admin.email} / ${DEV_ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
