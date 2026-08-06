import { Injectable } from '@nestjs/common';
import { Property } from '@prisma/client';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  LURRecord,
  MerkleProofData,
  VN_TIMEZONE,
  poseidonHash,
} from '@land-registry/blockchain/shared';

import { IssuerService } from './issuer.service';
import { PdfService } from './pdf.service';
import { Receipt, buildReceipt, buildSecretFile } from './receipt.builder';
import { ZipService } from './zip.service';
import { toLURRecord } from '../records/record.mapper';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * IssuanceService
 * ─────────────────────────────────────────────────────────────────────────────
 * Turns published registry state into per-property owner bundles (D31, §3.1).
 */

export interface BundleSource {
  property: Property;
  ownerSecret: bigint;
  merkleProof: MerkleProofData;
}

export interface PublishedRootContext {
  rootVersion: number;
  merkleRoot: bigint;
  transactionHash: string;
  contractAddress: string;
  /** Sepolia only — turns the PDF QR into an Etherscan link */
  explorerTxUrlPrefix?: string;
}

export interface BuiltBundle {
  propertyId: string;
  zip: Buffer;
  receipt: Receipt;
}

@Injectable()
export class IssuanceService {
  constructor(
    private readonly issuer: IssuerService,
    private readonly pdf: PdfService,
    private readonly zip: ZipService,
  ) {}

  /**
   * A fresh owner secret. Uses 31 bytes (248 bits) so the value is always below
   * the BN254 scalar field modulus — the same bound generateMockData.ts uses.
   */
  generateOwnerSecret(): bigint {
    return BigInt('0x' + randomBytes(31).toString('hex'));
  }

  /** ownerCommitment = Poseidon([ownerSecret]) — hashing stays in the shared layer. */
  async commitmentFor(ownerSecret: bigint): Promise<bigint> {
    return poseidonHash([ownerSecret]);
  }

  /**
   * Build one ZIP per property: receipt.json + secret.json + certificate.pdf.
   *
   * The returned buffers each contain an ownerSecret. Whoever calls this owns
   * the decision of how long they exist and who can fetch them.
   */
  async buildBundles(
    sources: BundleSource[],
    context: PublishedRootContext,
  ): Promise<BuiltBundle[]> {
    const issuer = this.issuer.buildIssuerBlock();
    const issuedOn = dayjs().tz(VN_TIMEZONE).format('YYYY-MM-DDTHH:mm:ssZ');

    const bundles: BuiltBundle[] = [];
    for (const source of sources) {
      bundles.push(await this.buildBundle(source, context, issuer, issuedOn));
    }
    return bundles;
  }

  private async buildBundle(
    source: BundleSource,
    context: PublishedRootContext,
    issuer: ReturnType<IssuerService['buildIssuerBlock']>,
    issuedOn: string,
  ): Promise<BuiltBundle> {
    const record: LURRecord = toLURRecord(source.property);

    const receipt = buildReceipt({
      property: source.property,
      record,
      merkleProof: source.merkleProof,
      rootVersion: context.rootVersion,
      merkleRoot: context.merkleRoot,
      transactionHash: context.transactionHash,
      contractAddress: context.contractAddress,
      issuer,
      issuedOn,
    });

    const explorerUrl = context.explorerTxUrlPrefix
      ? `${context.explorerTxUrlPrefix}${context.transactionHash}`
      : undefined;
    const pdf = await this.pdf.renderCertificate(receipt, explorerUrl);

    const zip = await this.zip.create([
      { name: 'receipt.json', content: JSON.stringify(receipt, null, 2) },
      {
        name: 'secret.json',
        content: JSON.stringify(buildSecretFile(record.propertyId, source.ownerSecret), null, 2),
      },
      { name: 'certificate.pdf', content: pdf },
      { name: 'README.txt', content: OWNER_README },
    ]);

    return { propertyId: source.property.propertyId, zip, receipt };
  }
}

const OWNER_README = `BỘ HỒ SƠ QUYỀN SỬ DỤNG ĐẤT (BẢN ĐIỆN TỬ)
=========================================

Bộ hồ sơ này gồm 3 tệp:

1. receipt.json   — CHIA SẺ ĐƯỢC.
   Chứa thông tin thửa đất, bằng chứng Merkle và chuỗi chứng thư của cơ quan
   phát hành. Đây là tệp bạn nạp vào cổng Chủ sở hữu để tạo bằng chứng ZK.

2. secret.json    — TUYỆT ĐỐI KHÔNG CHIA SẺ.
   Chứa ownerSecret — thứ chứng minh bạn là chủ thửa đất này. Ai có tệp này
   có thể tạo bằng chứng sở hữu và ký chuyển nhượng thay bạn, đúng như khi
   ai đó cầm sổ đỏ giấy của bạn. Hệ thống KHÔNG lưu bản sao: mất là không
   khôi phục được.

3. certificate.pdf — bản in thông tin kèm mã QR đối chiếu gốc Merkle on-chain.

LƯU Ý VỀ TÍNH MỚI CỦA BẰNG CHỨNG MERKLE
---------------------------------------
Mỗi lần có giao dịch chuyển nhượng trong hệ thống, gốc Merkle thay đổi và
trường "merkleProof" trong receipt.json trở nên cũ. Cổng Chủ sở hữu tự động
lấy bằng chứng mới trước khi tạo proof — bạn không cần thao tác gì. Trường
"rootVersion" là dấu hiệu để đối chiếu.
`;
