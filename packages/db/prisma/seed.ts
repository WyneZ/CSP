// Local dev bootstrap only. Creates the one tenant this v1 needs and one
// user per role to log in with. Idempotent — safe to run more than once.
// Never run this against a real deployment; it prints known passwords to
// the console on purpose.
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEV_TENANT_NAME = "Dev Contractor";
const DEV_PASSWORD = "dev-password-123"; // local only — never a real credential

const DEV_USERS = [
  { email: "admin@dev.local", name: "Dev Admin", role: "ADMIN" as const },
  { email: "engineer@dev.local", name: "Dev Site Engineer", role: "SITE_ENGINEER" as const },
  { email: "storekeeper@dev.local", name: "Dev Storekeeper", role: "STOREKEEPER" as const },
  { email: "viewer@dev.local", name: "Dev Viewer", role: "VIEWER" as const },
];

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

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  console.log("Seeded:");
  console.log(`  tenant: ${tenant.name} (${tenant.id})`);

  for (const u of DEV_USERS) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
      },
    });
    console.log(`  ${u.role.padEnd(14)}: ${u.email} / ${DEV_PASSWORD}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
