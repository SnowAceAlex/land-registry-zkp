import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActorRequest } from './actor';
import { resolveActor } from './actor-resolver';

export const GOV_API_KEY_HEADER = 'x-gov-api-key';

/**
 * The OpenAPI security scheme name for {@link ApiKeyGuard}.
 *
 * Kept here rather than in swagger.ts because `@ApiSecurity(GOV_API_KEY_SECURITY)`
 * has to mirror `@UseGuards(ApiKeyGuard)` on every route, and nothing enforces
 * that — a route can be guarded but undocumented, or documented but open. Having
 * one import site for both makes the pairing visible at the point of use.
 */
export const GOV_API_KEY_SECURITY = 'gov-api-key';

/**
 * ApiKeyGuard
 * ─────────────────────────────────────────────────────────────────────────────
 * Guards the state-authority endpoints with an API key (D14 — the authority is
 * mocked for the PoC; a real deployment would use the officer's institutional
 * identity, noted in Limitations). Since D86 the key resolves to an office
 * actor: the env GOV_API_KEY is HQ, any other key is a per-office credential.
 *
 * This is what separates "anyone can compute a projected root" (public, no
 * judgement involved) from "someone approves a transfer and publishes it"
 * (D28 — the step that deliberately requires a human with authority).
 *
 * Lives in common/ because it guards two modules — GovernmentController wholly,
 * TransfersController per-method (D28: preview/submit public, approve/reject
 * gated) — so it belongs to neither.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const provided = request.header(GOV_API_KEY_HEADER);
    const actor = provided
      ? await resolveActor(this.prisma, provided, process.env.GOV_API_KEY)
      : null;
    if (!actor) {
      throw new UnauthorizedException(`Missing or invalid ${GOV_API_KEY_HEADER} header`);
    }
    request.actor = actor;
    return true;
  }
}
