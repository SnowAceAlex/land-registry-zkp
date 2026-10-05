/**
 * test/shared/statusAttestation.test.ts — the one EIP-712 definition (D82).
 * The contract-side parity check lives in LandRegistryVerifier.mock.test.ts.
 */

import { expect } from 'chai';
import { ethers } from 'ethers';

import { PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import {
  ATTESTATION_TTL_SECONDS,
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '../../shared/statusAttestation';

const VERIFIER = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

describe('shared/statusAttestation', () => {
  it('keeps the TTL equal to the proof freshness window (D26)', () => {
    expect(ATTESTATION_TTL_SECONDS).to.equal(600);
  });

  it('reads root, propertyId and commitment at the indices PUBLIC_SIGNAL_ORDER names', () => {
    for (const circuit of ['ownership', 'mortgage'] as const) {
      const order = PUBLIC_SIGNAL_ORDER[circuit] as readonly string[];
      const signals = order.map((_, i) => String(100 + i));
      const message = attestationMessageFromSignals(circuit, signals, '1790000000');

      expect(message.merkleRoot).to.equal(BigInt(signals[order.indexOf('merkleRoot')]));
      expect(message.propertyId).to.equal(BigInt(signals[order.indexOf('propertyId')]));
      expect(message.ownerCommitment).to.equal(BigInt(signals[order.indexOf('ownerCommitment')]));
      expect(message.expiresAt).to.equal(1790000000n);
    }
  });

  it('refuses a transfer proof — verifyTransfer takes no attestation', () => {
    expect(() =>
      attestationMessageFromSignals('transfer' as never, ['1', '2', '3', '4', '5', '6', '7'], 1n),
    ).to.throw(/ownership or mortgage/);
  });

  it('round-trips through an ethers signature', async () => {
    const wallet = ethers.Wallet.createRandom();
    const typed = statusAttestationTypedData(31337, VERIFIER, {
      propertyId: 7n,
      ownerCommitment: 123n,
      merkleRoot: 456n,
      expiresAt: 1790000000n,
    });

    const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
    expect(ethers.verifyTypedData(typed.domain, typed.types, typed.message, signature)).to.equal(
      wallet.address,
    );

    // Another chain or another verifier must not accept the same signature.
    const otherChain = statusAttestationTypedData(11155111, VERIFIER, typed.message);
    expect(
      ethers.verifyTypedData(otherChain.domain, otherChain.types, otherChain.message, signature),
    ).to.not.equal(wallet.address);
  });
});
