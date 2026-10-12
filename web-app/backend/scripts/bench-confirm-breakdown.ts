// Per-plot cost of the D77 buyers' archive in confirm(): overlay proof, receipt + PDF, ZIP. Read-only.
// DATABASE_URL=$BENCH_DB SAMPLE=200 pnpm --filter backend run bench:confirm-breakdown
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { hashRecord } from '@land-registry/blockchain/shared';

import { AppModule } from '../src/app.module';
import { ChainService } from '../src/chain/chain.service';
import { ArchiveEntry, ArchiveService } from '../src/issuance/archive.service';
import { IssuanceService } from '../src/issuance/issuance.service';
import { PdfService } from '../src/issuance/pdf.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { toLURRecord } from '../src/records/record.mapper';
import { NodeStoreService } from '../src/tree/node-store.service';

const SAMPLE = Number(process.env.SAMPLE ?? 200);

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1e6;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const nodes = app.get(NodeStoreService);
  const issuance = app.get(IssuanceService);
  const pdf = app.get(PdfService);
  const archive = app.get(ArchiveService);
  const chain = app.get(ChainService);

  const properties = await prisma.property.findMany({
    where: { status: 'ISSUED' },
    orderBy: { id: 'desc' },
    take: SAMPLE,
  });

  // Unchanged leaves: the overlay has the same shape and cost as a real round's.
  // Seeded rows carry no `leaf` column, so it is hashed from the record.
  const leaves = new Map<string, bigint>();
  for (const p of properties) leaves.set(p.propertyId, await hashRecord(toLURRecord(p)));
  const updates = new Map(properties.map((p) => [Number(p.propertyId), leaves.get(p.propertyId)!]));
  const projectStart = process.hrtime.bigint();
  const overlay = await nodes.projectRoot(updates);
  const projectMs = ms(projectStart);

  const { issuer, issuedOn } = issuance.batchContext();
  const context = {
    rootVersion: 1,
    merkleRoot: overlay.root,
    transactionHash: '0x' + '0'.repeat(64),
    contractAddress: chain.rootRegistryAddress,
    explorerTxUrlPrefix: chain.explorerTxUrlPrefix,
  };

  const proofMs: number[] = [];
  const bundleMs: number[] = [];
  const pdfMs: number[] = [];
  const entries: ArchiveEntry[] = [];

  for (const property of properties) {
    let t = process.hrtime.bigint();
    const merkleProof = await nodes.proofInOverlay(
      property,
      leaves.get(property.propertyId)!,
      overlay,
    );
    proofMs.push(ms(t));

    t = process.hrtime.bigint();
    const built = await issuance.buildBundleFiles(
      { property, ownerSecret: 12345n, merkleProof },
      context,
      issuer,
      issuedOn,
    );
    bundleMs.push(ms(t));

    // The same render again, alone, to split the PDF out of buildBundleFiles.
    t = process.hrtime.bigint();
    await pdf.renderCertificate(built.receipt, undefined);
    pdfMs.push(ms(t));

    entries.push({
      propertyId: property.propertyId,
      certificateSerial: property.certificateSerial,
      leaf: leaves.get(property.propertyId)!.toString(),
      files: built.files,
    });
  }

  const zipStart = process.hrtime.bigint();
  const zip = await archive.build({
    kind: 'changeset',
    batchId: 0,
    rootVersion: 1,
    txHash: null,
    publishedAt: new Date(),
    entries,
  });
  const zipMs = ms(zipStart);

  const perPlot = {
    proofInOverlay: median(proofMs),
    buildBundleFiles: median(bundleMs),
    pdfRender: median(pdfMs),
    zip: zipMs / SAMPLE,
  };
  const totalPerPlot = (sum(proofMs) + sum(bundleMs) + zipMs) / SAMPLE;
  const report = {
    kind: 'confirm-breakdown' as const,
    at: new Date().toISOString(),
    sample: SAMPLE,
    projectRootMs: Math.round(projectMs),
    medianMsPerPlot: perPlot,
    meanMsPerPlot: {
      proofInOverlay: sum(proofMs) / SAMPLE,
      buildBundleFiles: sum(bundleMs) / SAMPLE,
      pdfRender: sum(pdfMs) / SAMPLE,
      zip: zipMs / SAMPLE,
      total: totalPerPlot,
    },
    zipBytes: zip.length,
    zipBytesPerPlot: Math.round(zip.length / SAMPLE),
    projectedFor2994: {
      seconds: Math.round((totalPerPlot * 2994) / 1000),
      zipMb: Math.round(((zip.length / SAMPLE) * 2994) / 1024 / 1024),
    },
    machine: { platform: process.platform, cpus: os.cpus().length, node: process.version },
  };

  const dir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'blockchain',
    'bench',
    'results',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'confirm-breakdown.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`  report: ${dir}`);

  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
