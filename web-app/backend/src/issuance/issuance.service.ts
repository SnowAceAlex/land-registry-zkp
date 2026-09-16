import { Injectable } from '@nestjs/common';
import { Property } from '@prisma/client';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  LURRecord,
  MerkleProofData,
  Receipt,
  VN_TIMEZONE,
  poseidonHash,
} from '@land-registry/blockchain/shared';

import { IssuerService } from './issuer.service';
import { PdfService } from './pdf.service';
import { buildReceipt, buildSecretFile } from './receipt.builder';
import { ZipEntry, ZipService } from './zip.service';
import { toLURRecord } from '../records/record.mapper';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * IssuanceService
 * ─────────────────────────────────────────────────────────────────────────────
 * Turns published registry state into per-property owner bundles (D31, §3.1).
 */

/** What a receipt is built from: a row and its proof against a published root. */
export interface ReceiptSource {
  property: Property;
  merkleProof: MerkleProofData;
}

export interface BundleSource extends ReceiptSource {
  ownerSecret: bigint;
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
    const { issuer, issuedOn } = this.batchContext();

    const bundles: BuiltBundle[] = [];
    for (const source of sources) {
      bundles.push(await this.buildBundle(source, context, issuer, issuedOn));
    }
    return bundles;
  }

  /**
   * The files that make up one owner's bundle, unpacked.
   *
   * Split out from buildBundle so the batch archive (D42) can place them under a
   * per-property folder without unzipping and re-zipping a bundle that was just
   * built. buildBundle stays the single-plot path, unchanged in behaviour.
   */
  async buildBundleFiles(
    source: BundleSource,
    context: PublishedRootContext,
    issuer: ReturnType<IssuerService['buildIssuerBlock']>,
    issuedOn: string,
  ): Promise<{ propertyId: string; receipt: Receipt; files: ZipEntry[] }> {
    const { receipt, receiptFile, certificateFile } = await this.buildReceiptFiles(
      source,
      context,
      issuer,
      issuedOn,
    );

    return {
      propertyId: source.property.propertyId,
      receipt,
      files: [
        receiptFile,
        {
          name: 'secret.json',
          content: JSON.stringify(
            buildSecretFile(BigInt(source.property.propertyId), source.ownerSecret),
            null,
            2,
          ),
        },
        certificateFile,
        { name: 'README.txt', content: OWNER_README },
      ],
    };
  }

  /**
   * The new owner's bundle after a published transfer (D51): receipt.json,
   * certificate.pdf and README.txt — and deliberately no secret.json.
   *
   * The buyer's secret was generated in the officer's browser at the counter
   * and never reached this backend, so there is nothing to put in one. The
   * README tells the buyer to pair this with the secret.json handed over there.
   */
  async buildBuyerBundle(
    source: ReceiptSource,
    context: PublishedRootContext,
    issuedAt: Date,
  ): Promise<{ zip: Buffer; receipt: Receipt }> {
    const { receipt, receiptFile, certificateFile } = await this.buildReceiptFiles(
      source,
      context,
      this.issuer.buildIssuerBlock(),
      formatIssuedOn(issuedAt),
    );
    const zip = await this.zip.create([
      receiptFile,
      certificateFile,
      { name: 'README.txt', content: BUYER_README },
    ]);
    return { zip, receipt };
  }

  /**
   * The shareable half of any bundle: the receipt and the certificate printed
   * from it. One implementation for the owner bundle and the buyer bundle, so
   * the two can never describe a record differently.
   */
  private async buildReceiptFiles(
    source: ReceiptSource,
    context: PublishedRootContext,
    issuer: ReturnType<IssuerService['buildIssuerBlock']>,
    issuedOn: string,
  ): Promise<{ receipt: Receipt; receiptFile: ZipEntry; certificateFile: ZipEntry }> {
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

    return {
      receipt,
      receiptFile: { name: 'receipt.json', content: JSON.stringify(receipt, null, 2) },
      certificateFile: { name: 'certificate.pdf', content: pdf },
    };
  }

  private async buildBundle(
    source: BundleSource,
    context: PublishedRootContext,
    issuer: ReturnType<IssuerService['buildIssuerBlock']>,
    issuedOn: string,
  ): Promise<BuiltBundle> {
    const { propertyId, receipt, files } = await this.buildBundleFiles(
      source,
      context,
      issuer,
      issuedOn,
    );
    return { propertyId, zip: await this.zip.create(files), receipt };
  }

  /** One issuer block + timestamp for a whole batch, so every bundle agrees. */
  batchContext() {
    return {
      issuer: this.issuer.buildIssuerBlock(),
      issuedOn: formatIssuedOn(new Date()),
    };
  }
}

/** `issuedOn` wire format: ISO-8601 with the +07:00 offset (D10). */
function formatIssuedOn(date: Date): string {
  return dayjs(date).tz(VN_TIMEZONE).format('YYYY-MM-DDTHH:mm:ssZ');
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

const BUYER_README = `BỘ HỒ SƠ QUYỀN SỬ DỤNG ĐẤT SAU CHUYỂN NHƯỢNG (BẢN ĐIỆN TỬ)
==========================================================

Bộ hồ sơ này gồm 2 tệp, cấp cho chủ sử dụng đất MỚI sau khi giao dịch chuyển
nhượng đã được công bố lên blockchain:

1. receipt.json   — CHIA SẺ ĐƯỢC.
   Thông tin thửa đất đứng tên commitment của bạn, bằng chứng Merkle theo gốc
   Merkle hiện hành và chuỗi chứng thư của cơ quan phát hành.

2. certificate.pdf — bản in thông tin kèm mã QR đối chiếu gốc Merkle on-chain.

BỘ HỒ SƠ NÀY KHÔNG CÓ secret.json
---------------------------------
secret.json của bạn đã được tạo và giao cho bạn TẠI QUẦY khi làm thủ tục chuyển
nhượng. Hệ thống không bao giờ nhận được tệp đó, nên không thể gửi lại. Hãy đặt
secret.json đã nhận tại quầy cùng thư mục với receipt.json này: cổng Chủ sở hữu
cần cả hai để tạo bằng chứng ZK. TUYỆT ĐỐI KHÔNG CHIA SẺ secret.json.

LƯU Ý VỀ TÍNH MỚI CỦA BẰNG CHỨNG MERKLE
---------------------------------------
Mỗi lần gốc Merkle thay đổi, trường "merkleProof" trong receipt.json trở nên cũ.
Cổng Chủ sở hữu tự động lấy bằng chứng mới trước khi tạo proof. Trường
"rootVersion" là dấu hiệu để đối chiếu.
`;
