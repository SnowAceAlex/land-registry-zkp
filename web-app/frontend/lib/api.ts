/**
 * lib/api.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP client for communicating with the NestJS backend.
 * Base URL: http://localhost:3001/api (configured via NEXT_PUBLIC_BACKEND_URL)
 *
 * TODO:
 *  1. Install a fetch wrapper (optional — native fetch works in Next.js 14+):
 *     npm install axios  (optional)
 *
 *  2. Implement getRecords() — fetch all LUR records
 *     GET /api/records
 *
 *  3. Implement getRecord(propertyId) — fetch a single record
 *     GET /api/records/:propertyId
 *
 *  4. Implement requestProof(propertyId) — request Merkle proof for a property
 *     GET /api/proof/:propertyId
 *     Returns: MerkleProofData (siblings, pathIndices, leaf, root)
 *
 *  5. Implement verifyProofOnServer(proof) — backend off-chain verification
 *     POST /api/proof/verify
 *     Body: MerkleProofData
 *     Returns: { valid: boolean }
 *
 *  6. Add auth headers (wallet signature / JWT) when authentication is added
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Records API
// ─────────────────────────────────────────────────────────────────────────────

export async function getRecords(): Promise<unknown[]> {
  // TODO: replace unknown with PropertyDto type once backend DTOs are defined
  return apiFetch<unknown[]>('/records');
}

export async function getRecord(_propertyId: string): Promise<unknown> {
  // TODO: replace unknown with PropertyDto
  return apiFetch<unknown>(`/records/${_propertyId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof API
// ─────────────────────────────────────────────────────────────────────────────

export async function requestProof(_propertyId: string): Promise<unknown> {
  // TODO: returns MerkleProofData from backend
  return apiFetch<unknown>(`/proof/${_propertyId}`);
}

export async function verifyProofOnServer(_proof: unknown): Promise<{ valid: boolean }> {
  // TODO: implement
  return apiFetch<{ valid: boolean }>('/proof/verify', {
    method: 'POST',
    body: JSON.stringify(_proof),
  });
}
