import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ActorRequest } from './actor';

// D86: must run after ApiKeyGuard, which sets request.actor.
@Injectable()
export class CentralOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const actor = context.switchToHttp().getRequest<ActorRequest>().actor;
    if (actor?.scope !== 'CENTRAL') {
      throw new ForbiddenException({
        reason: 'CentralScopeRequired',
        message: 'This action is restricted to the head office and its sites (D86)',
      });
    }
    return true;
  }
}

export const CentralOnly = () => applyDecorators(UseGuards(CentralOnlyGuard));
