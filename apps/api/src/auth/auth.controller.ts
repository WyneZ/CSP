import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginSchema } from '@csp-erp/schemas';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './guards/session-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    const { email, password } = loginSchema.parse(body);
    const user = await this.authService.validateCredentials(email, password);

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.user = { id: user.id, tenantId: user.tenantId, role: user.role, name: user.name };

    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
    res.clearCookie('connect.sid');
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@Req() req: Request) {
    return req.session.user;
  }
}
