import { createHash, randomBytes } from 'crypto';

export function generateOfficeKey(): string {
  return randomBytes(32).toString('hex');
}

export function hashOfficeKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
