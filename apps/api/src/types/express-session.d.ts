import "express-session";
import type { Role } from "@csp-erp/db";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      tenantId: string;
      role: Role;
      name: string;
    };
  }
}
