import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const SessionUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest<Request>();
    return req.session.user!;
  },
);
