import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from '../../common/types/authenticated-user';

@Injectable()
export class SseJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token.');
    }

    request.user = await this.jwt.verifyAsync<JwtPayload>(token, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'mebius-code-dev-jwt-secret',
    });
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const queryToken = request.query.access_token;
    if (typeof queryToken === 'string') {
      return queryToken;
    }

    const authorization = request.header('authorization');
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length);
    }

    return undefined;
  }
}

