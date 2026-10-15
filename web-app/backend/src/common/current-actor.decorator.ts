import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Actor, ActorRequest } from './actor';

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const actor = ctx.switchToHttp().getRequest<ActorRequest>().actor;
  // Reaching a handler without an actor means ApiKeyGuard was left off the route.
  if (!actor) throw new Error('CurrentActor used on a route without ApiKeyGuard');
  return actor;
});
