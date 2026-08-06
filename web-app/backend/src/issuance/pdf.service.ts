import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { Receipt, TenureType, fromUnixTimestamp } from '@land-registry/blockchain/shared';

import { landUseCodeLabel } from '../government/land-use-code.map';

/**
 * PdfService
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders the "sổ đỏ điện tử" companion PDF for an issued bundle (D17): a
 * plain information table mirroring sections I/II of a real GCN, plus a QR code
 * pointing at the on-chain root. No parcel diagram — deliberately out of scope.
 *
 * ⚠️ pdf-lib's built-in Helvetica cannot render Vietnamese diacritics (it is
 * WinAnsi-encoded and throws on U+1EA0–1EF9). Embedding a Unicode TTF through
 * fontkit is required, not cosmetic — DejaVu Sans ships with full Vietnamese
 * coverage via the `dejavu-fonts-ttf` package.
 */

const TENURE_LABEL: Record<number, string> = {
  [TenureType.PERPETUAL]: 'Lâu dài',
  [TenureType.FIXED_TERM]: 'Có thời hạn',
  [TenureType.PROJECT_LEASEHOLD]: 'Thuê theo dự án',
};

const ENCUMBRANCE_LABEL: Record<number, string> = {
  0: 'Không có',
  1: 'Đang thế chấp',
  2: 'Đang tranh chấp',
  3: 'Hạn chế chuyển nhượng',
};

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const LABEL_WIDTH = 170;

@Injectable()
export class PdfService {
  /**
   * @param receipt the same data written to receipt.json — the PDF is a human
   *   rendering of it, so the two can never disagree.
   * @param explorerUrl optional link the QR should point at (Sepolia
   *   Etherscan). Without one the QR carries the root reference as JSON, which
   *   is all a local-network demo can offer.
   */
  async renderCertificate(receipt: Receipt, explorerUrl?: string): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);

    const regular = await pdf.embedFont(readFont('DejaVuSans.ttf'), { subset: true });
    const bold = await pdf.embedFont(readFont('DejaVuSans-Bold.ttf'), { subset: true });

    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    y = this.drawHeader(page, bold, regular, receipt, y);
    y = this.drawSection(page, bold, 'I. THÔNG TIN NGƯỜI SỬ DỤNG ĐẤT', y);
    y = this.drawRows(page, regular, bold, y, [
      ['Mã định danh chủ sử dụng', shorten(receipt.record.ownerCommitment)],
      ['(Poseidon commitment)', 'Danh tính thật không lưu trên hệ thống'],
    ]);

    // Field order follows mẫu GCN in TT 10/2024: parcel no., map sheet, area,
    // purpose, form of use, term, origin.
    y = this.drawSection(page, bold, 'II. THÔNG TIN THỬA ĐẤT', y - 6);
    y = this.drawRows(page, regular, bold, y, [
      ['Số hiệu thửa đất', receipt.propertyId],
      ['Số tờ bản đồ', receipt.record.mapSheetNumber ?? '—'],
      ['Số vào sổ cấp GCN', receipt.record.bookEntryNumber],
      ['Địa chỉ', receipt.record.address],
      ['Diện tích', `${receipt.record.area.toLocaleString('vi-VN')} m²`],
      [
        'Mục đích sử dụng',
        `${receipt.record.landUseCode} — ${landUseCodeLabel(receipt.record.landUseCode)}`,
      ],
      ['Hình thức sử dụng', TENURE_LABEL[receipt.record.tenureType] ?? '—'],
      [
        'Thời hạn sử dụng',
        formatValidity(receipt.record.validityPeriod, receipt.record.tenureType),
      ],
      ['Nguồn gốc sử dụng đất', receipt.record.landOrigin ?? '—'],
      ['Tình trạng pháp lý', ENCUMBRANCE_LABEL[receipt.record.encumbranceStatus] ?? '—'],
      ['Cơ quan cấp', receipt.record.issuingAuthority],
      ['Ngày cấp', formatIsoDate(receipt.record.issueDate)],
    ]);

    // Điều 172 khoản 1 điểm a: an individual's agricultural term renews without
    // any procedure. A bare expiry date reads as "you lose the land that day",
    // which is the opposite of what the law says.
    const renewalNote = agriculturalRenewalNote(receipt);
    if (renewalNote) {
      page.drawText(renewalNote, {
        x: MARGIN + LABEL_WIDTH,
        y: y + 2,
        size: 7.5,
        font: regular,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 12;
    }

    y = this.drawSection(page, bold, 'III. NEO TRÊN BLOCKCHAIN', y - 6);
    y = this.drawRows(page, regular, bold, y, [
      ['Hợp đồng RootRegistry', receipt.contractAddress],
      ['Phiên bản gốc Merkle', String(receipt.rootVersion)],
      ['Merkle root', shorten(receipt.merkleRoot)],
      ['Giao dịch công bố', shorten(receipt.transactionHash)],
      ['Cơ quan phát hành', receipt.issuer.ethereumAccount],
    ]);

    await this.drawQr(pdf, page, receipt, regular, explorerUrl, y - 10);
    this.drawFooter(page, regular, receipt);

    return Buffer.from(await pdf.save());
  }

  private drawHeader(
    page: PDFPage,
    bold: PDFFont,
    regular: PDFFont,
    receipt: Receipt,
    y: number,
  ): number {
    page.drawText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
    });
    page.drawText('Độc lập - Tự do - Hạnh phúc', { x: MARGIN, y: y - 15, size: 10, font: regular });

    // Official name per khoản 21 Điều 3 Luật Đất đai 2024 + mẫu TT 10/2024.
    // It is too long for one line at this size, so it is set over two.
    page.drawText('GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT,', {
      x: MARGIN,
      y: y - 46,
      size: 13.5,
      font: bold,
    });
    page.drawText('QUYỀN SỞ HỮU TÀI SẢN GẮN LIỀN VỚI ĐẤT', {
      x: MARGIN,
      y: y - 63,
      size: 13.5,
      font: bold,
    });
    page.drawText('(Bản điện tử — phục vụ trình diễn hệ thống)', {
      x: MARGIN,
      y: y - 80,
      size: 9,
      font: regular,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(`Số phát hành: ${receipt.record.certificateSerial}`, {
      x: MARGIN,
      y: y - 99,
      size: 10,
      font: bold,
    });

    page.drawLine({
      start: { x: MARGIN, y: y - 110 },
      end: { x: PAGE_WIDTH - MARGIN, y: y - 110 },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2),
    });

    return y - 134;
  }

  private drawSection(page: PDFPage, bold: PDFFont, title: string, y: number): number {
    page.drawText(title, { x: MARGIN, y, size: 11, font: bold });
    return y - 20;
  }

  private drawRows(
    page: PDFPage,
    regular: PDFFont,
    bold: PDFFont,
    startY: number,
    rows: [string, string][],
  ): number {
    let y = startY;
    for (const [label, value] of rows) {
      page.drawText(label, { x: MARGIN, y, size: 9.5, font: regular, color: rgb(0.3, 0.3, 0.3) });

      // Long values (addresses) wrap rather than run off the page edge.
      const maxWidth = PAGE_WIDTH - MARGIN * 2 - LABEL_WIDTH;
      for (const line of wrap(value, bold, 9.5, maxWidth)) {
        page.drawText(line, { x: MARGIN + LABEL_WIDTH, y, size: 9.5, font: bold });
        y -= 14;
      }
      y -= 3;
    }
    return y;
  }

  private async drawQr(
    pdf: PDFDocument,
    page: PDFPage,
    receipt: Receipt,
    regular: PDFFont,
    explorerUrl: string | undefined,
    y: number,
  ): Promise<void> {
    const payload =
      explorerUrl ??
      JSON.stringify({
        contract: receipt.contractAddress,
        rootVersion: receipt.rootVersion,
        merkleRoot: receipt.merkleRoot,
      });

    const png = await QRCode.toBuffer(payload, { type: 'png', margin: 1, width: 320 });
    const image = await pdf.embedPng(png);
    const size = 110;

    page.drawImage(image, { x: MARGIN, y: y - size, width: size, height: size });
    page.drawText('Quét mã để đối chiếu gốc Merkle đã công bố', {
      x: MARGIN + size + 14,
      y: y - 34,
      size: 9,
      font: regular,
      color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText(explorerUrl ? 'Liên kết Etherscan' : 'Tham chiếu gốc (mạng cục bộ)', {
      x: MARGIN + size + 14,
      y: y - 50,
      size: 9,
      font: regular,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  private drawFooter(page: PDFPage, regular: PDFFont, receipt: Receipt): void {
    // States the scope gap rather than leaving it to be read as an omission:
    // the real GCN form also covers attached assets and post-issue changes,
    // neither of which this thesis models.
    page.drawText(
      'Bản rút gọn: chỉ thể hiện quyền sử dụng đất. Không bao gồm mục "Tài sản gắn liền với đất" ' +
        'và mục "Những thay đổi sau khi cấp GCN" của mẫu Thông tư 10/2024/TT-BTNMT.',
      { x: MARGIN, y: MARGIN - 8, size: 7, font: regular, color: rgb(0.45, 0.45, 0.45) },
    );
    page.drawText(
      `Phát hành lúc ${receipt.issuedOn} • Bản điện tử này chỉ có giá trị khi đối chiếu được với gốc Merkle on-chain.`,
      { x: MARGIN, y: MARGIN - 20, size: 7, font: regular, color: rgb(0.45, 0.45, 0.45) },
    );
  }
}

/** DejaVu Sans ships with the `dejavu-fonts-ttf` package — no binary in git. */
function readFont(fileName: string): Buffer {
  const fontPath = require.resolve(`dejavu-fonts-ttf/ttf/${fileName}`);
  return fs.readFileSync(fontPath);
}

function shorten(value: string, head = 12, tail = 8): string {
  return value.length <= head + tail + 3 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function formatValidity(validityPeriod: string, tenureType: number): string {
  // The 0 sentinel means "no expiry" for perpetual tenure (D5) — printing the
  // epoch date instead would read as "01/01/1970".
  if (tenureType === TenureType.PERPETUAL || validityPeriod === '0') {
    return 'Lâu dài';
  }
  return `Đến ngày ${fromUnixTimestamp(BigInt(validityPeriod))}`;
}

/**
 * Note printed under the expiry date for agricultural land held by an
 * individual: the term renews automatically (Điều 172 khoản 1 điểm a), so the
 * date is not a deadline the holder has to act on.
 */
function agriculturalRenewalNote(receipt: Receipt): string | undefined {
  const isIndividual = !receipt.record.landUserType || receipt.record.landUserType === 'CNV';
  const hasTerm = receipt.record.tenureType === TenureType.FIXED_TERM;
  if (!isIndividual || !hasTerm || receipt.record.validityPeriod === '0') {
    return undefined;
  }
  return (
    'Hết thời hạn được tiếp tục sử dụng mà không phải làm thủ tục gia hạn ' +
    '(Điều 172 khoản 1 điểm a Luật Đất đai 2024).'
  );
}

function formatIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** Greedy word wrap against the font's real measured width. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}
