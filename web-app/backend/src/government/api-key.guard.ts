import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

export const GOV_API_KEY_HEADER = 'x-gov-api-key';

/**
 * ApiKeyGuard
 * ─────────────────────────────────────────────────────────────────────────────
 * Guards the state-authority endpoints with a static API key (D14 — the
 * authority is mocked for the PoC; a real deployment would use the officer's
 * institutional identity, noted in Limitations).
 *
 * This is what separates "anyone can compute a projected root" (public, no
 * judgement involved) from "someone approves a transfer and publishes it"
 * (D28 — the step that deliberately requires a human with authority).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.GOV_API_KEY;
    if (!expected) {
      throw new UnauthorizedException(
        'GOV_API_KEY is not configured on the server — government endpoints are disabled',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(GOV_API_KEY_HEADER);
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException(`Missing or invalid ${GOV_API_KEY_HEADER} header`);
    }
    return true;
  }
}

/** Constant-time compare so a wrong key cannot be discovered byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
