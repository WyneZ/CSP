import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { prisma } from '@csp-erp/db';

@Injectable()
export class AuthService {
  async validateCredentials(email: string, password: string) {
    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return user;
  }
}
