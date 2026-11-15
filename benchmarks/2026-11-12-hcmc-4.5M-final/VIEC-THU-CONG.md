# Việc thủ công: chạy hệ thống bằng tay để hiểu nó và lấy số cho thesis

Lập ngày 15/11/2026, sau đợt đo tự động 12–15/11 (`README.md` cùng thư mục). Những gì máy tự chạy được đã chạy.
Phần còn lại cần một người ngồi trước trình duyệt: ký MetaMask, nhìn màn hình, chụp ảnh, bấm giờ trong browser.

Tài liệu này không chép lại ba runbook. Nó chỉ cho bạn **làm theo thứ tự nào**, **ở mỗi bước đang thấy cơ chế gì của
hệ thống**, và **cần ghi lại số hay ảnh nào** cho Chương 5. Làm hết một lượt trên Hardhat mất khoảng 3 giờ, thêm khoảng
1 giờ cho Sepolia.

---

## 0. Bức tranh hệ thống trong một trang

Đọc mục này trước. Mỗi bước thủ công phía sau đều là một mảnh của bức tranh này.

**Ba thao tác ghi, không hơn (D83).** Cấp mới (UC-1), chuyển nhượng (UC-3), thu hồi (UC-4). Cấp đổi, tách thửa, hợp
thửa, kết quả toà án đều là *thu hồi sổ cũ + cấp sổ mới với `propertyId` mới*. Sổ mới khai nó thay cho sổ nào lúc
nhập dữ liệu (`supersedesPropertyIds`), nên lịch sử mảnh đất không đứt khi đổi mã (D90).

**Sổ nằm ở đâu.** Toàn bộ hồ sơ (địa chỉ, diện tích, thời hạn, tình trạng thế chấp…) nằm trong Postgres của cơ quan.
Trên blockchain chỉ có **một số 32 byte**: gốc (root) của một cây Merkle độ sâu 24. Mỗi giấy chứng nhận là một lá; vị trí
của lá chính là `propertyId` (D41). Lá là băm Poseidon của 7 trường: mã thửa, cam kết chủ sở hữu, loại đất, thời hạn,
tình trạng thế chấp, hình thức sử dụng, và băm của phần thông tin in trên giấy (`offchainHash`, D36).

**Chủ sở hữu là ai.** Không có tên trong cây. Chỉ có `ownerCommitment = Poseidon(ownerSecret)`. Ai giữ `secret.json`
thì chứng minh được mình là chủ. Secret do cơ quan sinh ra lúc đề nghị cấp (hoặc lúc mở hồ sơ chuyển nhượng, cho người
mua) và giao một lần trong tệp ZIP của đợt (D77, D87).

**Đợt vào sổ (round, `ChangeSet`, "Chốt sổ").** Hồ sơ không lên chain từng cái. Cấp mới, chuyển nhượng đã duyệt và thu hồi
xếp vào một hàng chờ chung (D87). Trung tâm bấm "Chốt sổ":
1. backend tính trước root mới của cả hàng chờ và lưu thành bản nháp, **chưa ghi gì vào sổ** (D43);
2. ví MetaMask của cán bộ ký `publishRoot` (hoặc `publishRootWithRevocations` khi có thu hồi);
3. backend đọc lại root trên chain, thấy khớp mới ghi chủ mới, sự kiện lịch sử và tệp ZIP theo từng chi nhánh (D88).

Backend không giữ khoá nào ghi được lên chain. Mỗi lần đổi root, mọi Merkle path cũ đều hết hạn, nên người dân luôn
xin path mới (`GET /api/proof/:id`) trước khi tạo proof.

**Ba loại proof (Groth16, tạo trong trình duyệt).**
- *Ownership*: "tôi giữ secret của lá đang nằm trong root hiện hành", không lộ gì khác.
- *Mortgage / clean-title*: như trên, cộng "không bị thế chấp và còn ít nhất N năm sử dụng". N do người hỏi (ngân hàng)
  đặt; ngày hết hạn thật và tình trạng thế chấp không bao giờ lộ.
- *Transfer*: tạo ở quầy, chứng minh lá cũ và lá mới chỉ khác nhau ở chủ sở hữu.

**Bốn luật mà ai kiểm proof cũng áp, theo đúng thứ tự (D33):** proof còn tươi (dưới 10 phút, `StaleTimestamp`) →
đúng về mật mã (`InvalidProof`) → root của proof là root hiện hành (`RootMismatch`) → có xác nhận tình trạng còn hạn
(`AttestationExpired` / `InvalidAttestation`). Contract `LandRegistryVerifier` và trang UC-6 áp cùng bốn luật.

**Xác nhận tình trạng (status attestation, D82).** Trước khi tạo proof ownership/mortgage, trình duyệt xin backend một chữ
ký EIP-712 nói "thửa này hiện không có thủ tục nào đang mở", hạn 10 phút. Khi thửa có hồ sơ chuyển nhượng hoặc thu hồi đang
mở, backend từ chối (409 `ProcedureOpen`). Đây là thứ chặn người bán đem sổ đi vay trong lúc chờ đợt vào sổ, mà không cần
giao dịch on-chain nào cho từng hồ sơ.

**Thu hồi.** Lá bị gỡ khỏi cây, nên không còn Merkle path, nên không proof nào tạo được nữa. Đó là cưỡng chế. Bitmap
`isRevoked(id)` trên chain cùng mã lý do trong event chỉ để công khai kiểm tra được (D45, D91).

**41 đơn vị (D85–D86).** Trụ sở và 2 cơ sở (trung tâm) nhập dữ liệu, cấp giấy, chốt sổ. 38 chi nhánh chỉ chuyển nhượng
và thu hồi thửa thuộc phường/xã của mình. Đăng nhập bằng khoá API của đơn vị, không theo từng người.

### Bảng từ ngữ: giao diện, code, thesis

| Trên giao diện | Trong code | Trong thesis (tiếng Anh) |
| --- | --- | --- |
| Đợt vào sổ, Chốt sổ | `ChangeSet`, `createDraft` / `confirm` | publishing round |
| Đề nghị cấp | `IssuanceRequest` (READY) | issuance request |
| Quầy chuyển nhượng | `TransfersService` preview / submit / approve | transfer counter |
| Xác nhận tình trạng | `AttestationService`, EIP-712 `StatusAttestation` | status attestation |
| Lá, gốc, phiên bản gốc | leaf, `latestRoot`, `rootVersion` | leaf, root, root version |
| Hồ sơ các đợt vào sổ (ZIP) | `ChangeSetArchive` theo chi nhánh | per-branch archive |
| Lịch sử mảnh đất | `PropertyLineage`, `/records/:id/lineage` | certificate lineage |
| Ngõ cụt "đang có thủ tục" | `procedure-open` | open-procedure dead end |

---

## 1. Cái gì đã có số, cái gì còn phải làm tay

**Đã đo tự động** (chi tiết và số ở `README.md`, mục 1–13 và mục bổ sung A1–A6):
test, constraint, prove/verify trong Node, gas từng thao tác, một tháng ở 4,5 triệu giấy trên Hardhat, 5 ngày thật trên
Sepolia, tải route proof và xác nhận tình trạng, kiểm đúng đắn cây ở 4,5 triệu (A2), tách thời gian tạo nháp (A3),
archive theo 38 chi nhánh (A1), độc lập với cỡ sổ (A4), tốc độ import (A5), và các case tấn công chạy được bằng CLI (A6).

**Còn lại, phải làm tay:**

| # | Việc | Vì sao máy không làm thay được | Mục |
| --- | --- | --- | --- |
| M1 | Chạy portal trên local theo `PHASE_10_MANUAL_TEST.md`, xen các bước resident của `PHASE_9_MANUAL_TEST.md` | MetaMask phải ký từng đợt; ba profile trình duyệt | 3 |
| M2 | Lặp lại phần chính trên Sepolia (`DEMO_SEPOLIA.md` §1–8) | Ví thật, ETH thật, Etherscan | 6 |
| M3 | Chụp 12 ảnh cho Chương 5 + Etherscan + tab Network | Cần màn hình thật | 7 |
| M4 | Bấm giờ tạo và kiểm proof trong trình duyệt | Cần trình duyệt thật, hai loại trình duyệt | 4 |
| M5 | Kiểm tab Network: secret không rời máy | Cần DevTools | 5 |
| M6 | Xem các case tấn công **trên giao diện** (thông báo, ngõ cụt) | Máy đã chứng minh bằng API/contract, còn thiếu ảnh và trải nghiệm | 8 |
| M7 | Phía thesis: link báo cho ước tính TP.HCM; sửa câu "tested end to end" sau M1–M2 | Quyết định của bạn | 9 |

---

## 2. Chuẩn bị một lần (Hardhat local)

Theo `PHASE_10_MANUAL_TEST.md` §1.1–1.4. Những điểm dễ vấp:

- **Dùng DB riêng cho lượt này**, đừng dùng DB bench. `prisma migrate reset` ở §1.1 xoá DB `land_registry` mặc định.
- **Không chạy `circuits:setup`.** Chỉ `circuits:sync-frontend`.
- **Lưu khoá CN01 và CN02** khi `seed:land-offices` in ra. Giữ ở ngoài repo.
- `web-app/backend/.env` khi chạy local: `AUTHORITY_PRIVATE_KEY` là khoá test Hardhat #0, `ATTESTER_PRIVATE_KEY` để trống
  hoặc là khoá Hardhat #1 (deploy local cấp quyền attester cho #1). Nếu `.env` đang trỏ ví Sepolia thì backend báo
  "identity anchor mismatch" và receipt sẽ trượt mắt xích D30. Đây đúng là lỗi đợt đo tự động đã gặp.
- **Node để yên quá 10 phút thì `block.timestamp` đứng im** → phê duyệt báo `StaleTimestamp`. Đào một block
  (`evm_mine`, lệnh ở `PHASE_10` §0c).
- **Cùng nguyên nhân, kiểm on-chain ở UC-6 ngay sau khi tạo proof có thể báo `InvalidAttestation`** dù mọi thứ đúng: contract
  chỉ nhận xác nhận khi block mới nhất không cũ hơn lúc backend ký (xem mục 8, "Phát hiện khi chạy A6"). Trên Hardhat, đào
  một block rồi kiểm lại. Đừng hiểu nhầm đây là tấn công.
- **`.env` gốc có thể đang đặt `ATTESTER_ADDRESS` (và `AUTHORITY_ADDRESS`) của Sepolia.** Khi đó `deploy:localhost` cấp
  quyền attester cho địa chỉ Sepolia, còn backend ký bằng khoá Hardhat #1: mọi proof ownership/mortgage bị
  `InvalidAttestation`, và backend báo ngay lúc khởi động "attester … does NOT hold ATTESTER_ROLE". Bỏ hai biến đó (hoặc đặt
  đúng địa chỉ Hardhat #0/#1) trước khi deploy local.
- **MetaMask nhớ nonce** của node cũ: Settings → Advanced → Clear activity tab data sau mỗi lần bật lại node.
- Ba profile Chrome: CN01, CN02, TT (trung tâm, có MetaMask). Mỗi ảnh chụp phải thấy dòng "Đơn vị: …" trên thanh trạng thái.
- Gói ZIP chứa `secret.json`: giải nén vào thư mục ngoài repo (ví dụ `D:\thesis\phase10-demo\`).

---

## 3. Lộ trình: một lượt `PHASE_10`, xen phần resident

Làm theo thứ tự dưới. Mỗi bước có bốn dòng: **Làm** (trỏ vào runbook), **Đang thấy gì** (cơ chế),
**Ghi lại** (số, ảnh), **Dùng ở** (thesis).

### 3.1 Nhập dữ liệu và đề nghị cấp (PHASE_10 Bước 1)

- **Làm:** Bước 1, profile TT, tệp `1-initial.csv`.
- **Đang thấy gì:**
  - Dry-run kiểm từng dòng theo luật đất đai hiện hành (D35) mà không ghi gì (D52).
  - Phường/xã trong địa chỉ quyết định chi nhánh của thửa (D85): Sài Gòn → CN01, Thủ Đức → CN02.
  - "Đề nghị cấp" chỉ xếp hàng và sinh secret cho chủ, chưa ký gì (D87).
  - Lệnh `curl … | grep -c ownerSecret` in 0: secret nằm trong DB nhưng không route nào trả ra (D50).
- **Ghi lại:** ảnh **`fig:r-import`** (kết quả dry-run có bảng "Theo chi nhánh").
- **Dùng ở:** Ch5 §5.3 (demo chức năng), Ch4 phần import.

### 3.2 Chốt sổ đợt #1, archive theo chi nhánh (PHASE_10 Bước 2)

- **Làm:** Bước 2.
- **Đang thấy gì:**
  - Ba pha của một đợt: nháp (root tính trước) → MetaMask ký `publishRoot` → confirm.
  - Thanh trạng thái nhảy lên "Gốc v1".
  - Mỗi chi nhánh một ZIP. CN01 chỉ tải được phần mình (CN01 thử tải phần CN02 → 403 `OutsideOfficeArea`); trung tâm
    tải được mọi phần và được ghi "thay thế".
- **Ghi lại:**
  - Ảnh **`fig:r-round`**: lấy cả popup MetaMask lúc ký và dòng "Đợt vào sổ #1 đã công bố (v1)".
  - Ảnh **`fig:r-archive`**: hai dòng CN01, CN02.
  - Số: gas đợt #1 (cột Gas ở trang Điều hành) và thời gian từ lúc bấm "Tạo đợt vào sổ" tới lúc thấy nháp.
- **Dùng ở:** Ch5 §5.3, `tab:gas` (đối chiếu với `publishRoot` lần đầu 115.651 gas).

### 3.3 Người dân tạo và kiểm proof (PHASE_9 §3.1–3.6, dùng bundle của đợt #1)

- **Làm:**
  - `/vi/resident/lookup` với 1001 (§3.1).
  - `/vi/resident/proof` với `round-1/1001/`, ownership (§3.2), rồi mortgage với ngưỡng 5 năm (§3.3).
  - `/vi/resident/verify`: tab thông thường, rồi tab "Thẩm tra cơ quan phát hành" với `receipt.json` (§3.5–3.6).
- **Đang thấy gì:**
  - Trang proof tự xin Merkle path mới và xin xác nhận tình trạng, rồi tạo proof **trong worker của trình duyệt**.
  - Panel kết quả chia "đã tiết lộ" và "không bao giờ tiết lộ". Với mortgage, ngày hết hạn và tình trạng thế chấp phải
    nằm ở cột "không bao giờ tiết lộ".
  - Trang verify chạy năm kiểm tra theo thứ tự: tươi, mật mã, khớp root, xác nhận tình trạng, contract.
  - Chuỗi D30 có bốn mắt xích: CA gốc → chứng thư cơ quan → chữ ký địa chỉ ví → anchor on-chain.
- **Ghi lại:**
  - Ảnh **`fig:r-prove`** (thấy loại proof, ngưỡng năm, thời gian tạo proof) và **`fig:r-verify-ok`** (năm dấu xanh
    + chuỗi cơ quan phát hành).
  - Số: thời gian theo mục 4.
  - Làm luôn kiểm tab Network theo mục 5.
- **Dùng ở:** Ch5 §5.3–5.5, `tab:circuit-cost` (cột browser).

### 3.4 Quầy chuyển nhượng và ràng buộc địa bàn (PHASE_10 Bước 3)

- **Làm:** Bước 3. CN02 thử chuyển nhượng thửa 1001 (bị chặn), rồi CN01 làm thật. **Chưa phê duyệt.**
- **Đang thấy gì:**
  - Chi nhánh chỉ được làm trên địa bàn mình (D86).
  - Ở quầy, secret của **người bán** chỉ dùng trong trình duyệt của cán bộ để tạo transfer proof, không gửi lên backend.
    Secret của **người mua** do backend sinh ở bước preview (D77).
  - Không có chữ ký ví nào ở quầy: hồ sơ đang mở chính là cái khoá (D80, D82).
- **Ghi lại:**
  - Ảnh **`fig:r-scope`** (thông báo "thuộc địa bàn của chi nhánh khác") và **`fig:r-counter`** (hồ sơ người bán hợp lệ →
    nộp → hàng chờ).
  - Số: thời gian "Đang tạo bằng chứng chuyển nhượng…" (transfer proof trong browser).
  - Kiểm Network ở quầy (mục 5).
- **Dùng ở:** Ch5 §5.3–5.4. Đây cũng là chỗ thesis phải nói rõ: ở quầy, secret người bán đi qua máy của cơ quan dù không
  tới backend.

### 3.5 Cửa sổ tấn công: bán hai lần trong lúc chờ (case a, sau Bước 3)

- **Làm:**
  - Thửa 1001 đang có hồ sơ chuyển nhượng PENDING. Người bán mở `/vi/resident/proof` với `round-1/1001/`.
  - Chạy `proof:bodies` với bundle đó, dán `mortgage.verify.json` vào `/vi/resident/verify` (PHASE_9 §3.10.1).
- **Đang thấy gì:**
  - UC-5 dừng ở ngõ cụt "Giấy chứng nhận đang có thủ tục chưa hoàn tất": backend từ chối xác nhận tình trạng.
  - Body tạo bằng CLI không có xác nhận, nên UC-6 đỏ ở bước 4 (`InvalidAttestation`).
  - Contract cũng từ chối.
- **Ghi lại:** ảnh **`fig:r-attack-window`** (ngõ cụt ở UC-5 và bước 4 đỏ ở UC-6).
- **Dùng ở:** Ch5 §5.9 (`tab:attacks`), Ch3 phần cơ chế xác nhận tình trạng.

### 3.6 Thu hồi ở chi nhánh, cảnh báo, sổ thay thế (PHASE_10 Bước 4–6)

- **Làm:** Bước 4 (CN01 thu hồi 1003, thử các lỗi địa bàn/xung đột), Bước 5 (cảnh báo rồi phê duyệt), Bước 6 (luật sổ
  thay thế).
- **Đang thấy gì:**
  - Lý do thu hồi lên chain chỉ là một mã (1–5) và băm của văn bản chi tiết. Văn bản thì ở lại DB (D45).
  - Một thửa chỉ có một thủ tục mở (D80).
  - Trang Điều hành cảnh báo nếu chốt sổ lúc này thì hồ sơ đang chờ duyệt sẽ hỏng (D89).
  - Sổ thay thế chỉ được đề nghị cấp khi sổ cũ đã thật sự bị thu hồi trên chain (D90).
- **Ghi lại:** ảnh **`fig:r-operations`** (trang Điều hành có cảnh báo và bảng hàng chờ theo đơn vị). Case (b) "chủ bị thu
  hồi đem sổ đi vay" làm y như mục 3.5 với 1003.
- **Dùng ở:** Ch5 §5.3, §5.9.

### 3.7 Chốt sổ đợt #2: chuyển nhượng + thu hồi cùng một root (PHASE_10 Bước 7)

- **Làm:** Bước 7. MetaMask phải hiện `publishRootWithRevocations`.
- **Đang thấy gì:**
  - Chuyển nhượng và thu hồi vào sổ dưới **một** root, cùng `rootVersion` (D84).
  - ZIP của đợt chứa bộ hồ sơ của **người mua**.
  - Người bán cũ mở UC-5 với bundle cũ thì nhận "Giấy chứng nhận không còn hiệu lực": lá đã đổi chủ.
  - Chủ thửa 1003 nhận "đã bị thu hồi": lá đã bị gỡ, `GET /api/proof/1003` trả 410.
  - `/resident/lookup` hiện sự kiện kèm phiên bản gốc và mã giao dịch, không có văn bản chi tiết của lý do.
- **Ghi lại:**
  - Ảnh **`fig:r-superseded`** (UC-5 với bundle người bán cũ) và **`fig:r-revoked`** (UC-5 thửa 1003 + trang tra cứu).
  - Số: gas đợt #2.
  - PHASE_9 §3.7: verify lại một proof cũ của 1003 → `RootMismatch`.
- **Dùng ở:** Ch5 §5.3, §5.9.

### 3.8 Cấp lại, tạm giữ, tách thửa, archive hết hạn (PHASE_10 Bước 8–9b)

- **Làm:** Bước 8, 9, 9b (Bước 10 tuỳ chọn).
- **Đang thấy gì:**
  - Sổ C′ (1101) mang mã mới, thay cho 1003.
  - Tạm giữ loại một mục khỏi đợt nhưng thửa vẫn bị khoá. Nháp đã tạo thì bất biến (`ItemInOpenDraft`).
  - Tách thửa D → D1, D2 vẫn là thu hồi + hai lần cấp mới.
  - Archive hết hạn chỉ đòi tick xác nhận, không khoá Chốt sổ.
- **Ghi lại:**
  - Ảnh **`fig:r-lineage`** (tra 1101: dòng thời gian 1003 → 1101).
  - Số: gas đợt #3 và #4, tổng số chữ ký MetaMask cả kịch bản (kỳ vọng 4).
- **Dùng ở:** Ch5 §5.3, Ch3 phần lineage.

### 3.9 Hai case còn lại trên giao diện

- **(j) Ví không có quyền publish:** ở trang Chốt sổ, đổi MetaMask sang một tài khoản Hardhat khác (#2) → portal chặn trước
  khi mở ví (thiếu `STATE_AUTHORITY_ROLE`). Chụp ảnh.
- **(l) Từ chối hồ sơ là mở khoá:** PHASE_8 §3.8 bước 6 hoặc DEMO_SEPOLIA §8.7: nộp hồ sơ cho 1002, UC-5 báo ngõ cụt, bấm
  **Từ chối** ở hàng chờ → chủ tạo proof lại được ngay, không cần giao dịch nào.

---

## 4. Bấm giờ trong trình duyệt (M4)

Số trong Node (đã có, 12/11): ownership p50 783 ms, mortgage 680 ms, transfer 1.143 ms; verify 13–16 ms. Trình duyệt chậm
hơn, và lần đầu còn phải tải zkey (6,2 / 6,2 / 12,3 MB).

Cách đo:
1. Ghi máy, trình duyệt và phiên bản (ví dụ Chrome 1xx, Firefox 1xx).
2. **Lần đầu**: DevTools → Network → bật "Disable cache", tải lại trang, tạo proof. Thời gian tải zkey đọc ở dòng
   `*.zkey` trong tab Network, thời gian proof đọc trên màn hình kết quả.
3. **Các lần sau**: tắt "Disable cache", tạo thêm 4 lần, lấy trung vị.
4. Làm trên Chrome và trên Firefox (hoặc Edge).

| Đo | Chrome: lần đầu | Chrome: trung vị 4 lần sau | Firefox/Edge: lần đầu | Firefox/Edge: trung vị |
| --- | --- | --- | --- | --- |
| UC-5 ownership | | | | |
| UC-5 mortgage (ngưỡng 5 năm) | | | | |
| Quầy: transfer proof | | | | |
| UC-6 verify off-chain (gồm tải vkey) | | | | |
| UC-6 `eth_call` verify on-chain (tab Network) | | | | |
| Tải `ownership.zkey` / `mortgage.zkey` / `transfer.zkey` | | — | | — |

Dùng ở `tab:circuit-cost`, cột browser, đặt cạnh số Node.

---

## 5. Kiểm tab Network (M5)

Đây là bằng chứng cho câu quan trọng nhất về quyền riêng tư: secret và hồ sơ không rời máy người dân.

1. **Trang resident** (PHASE_9 §3.2, "Bước DoD"):
   - DevTools → Network, bật Preserve log, xoá log, làm lại luồng tạo proof.
   - Chỉ được có `GET /api/public/config`, `GET /api/proof/<id>`, `GET /api/proof/<id>/attestation`, tệp
     `/circuits/...` và tài nguyên của Next. Không có POST nào.
   - Ô lọc: gõ giá trị `ownerSecret` trong `secret.json` → **0 kết quả**. Gõ giá trị `area` và chuỗi địa chỉ trong
     `receipt.json` → **0 kết quả**.
2. **Quầy** (PHASE_10 Bước 3.4, PHASE_8 §3.4.5):
   - Chỉ có `POST /api/transfers/preview` và `POST /api/transfers` đi ra.
   - `ownerSecret` của người bán → 0 kết quả. Secret người mua có trong response của preview và body của submit; đó là
     thiết kế (D77).
3. Chụp màn hình ô lọc với 0 kết quả, cho cả hai trang.

---

## 6. Sepolia (M2)

Theo `DEMO_SEPOLIA.md` §1–8 với `demoImport.csv` (thửa 201–210). Khác local ở ba điểm:
- **Mỗi lần ký phải chờ block** (~12 s; đợt đo tự động thấy 17–42 s).
- **Có Etherscan:** chụp giao dịch của đợt có thu hồi, thấy các event `PropertyRevoked`, và trang contract `RootRegistry`.
- **Contract:** nếu dùng lại contract 26/10 (`blockchain/deployments/sepolia.json`), các id 201–210 phải chưa từng bị thu
  hồi trên đó (nếu không sẽ gặp `AlreadyRevoked`); hoặc deploy mới. Ví deployer còn ~7,1 ETH. Deploy mới tốn ~21 triệu
  gas (~0,02 ETH ở tip 1 gwei); các đợt của demo thì nhỏ (`publishRoot` lần đầu 461.531 gas, mỗi thu hồi ~114 nghìn).

Ghi lại: tx hash từng đợt, `rootVersion`, link Etherscan, thời gian chờ block, phí từng đợt (đọc trên Etherscan).

---

## 7. Danh sách ảnh (M3)

| Label | Chụp ở mục | Phải thấy |
| --- | --- | --- |
| `fig:r-import` | 3.1 | số dòng hợp lệ / lỗi, bảng theo chi nhánh |
| `fig:r-round` | 3.2 | popup MetaMask `publishRoot`, "Đợt vào sổ #1 đã công bố (v1)" |
| `fig:r-archive` | 3.2 | mỗi chi nhánh một ZIP; chi nhánh chỉ thấy phần mình |
| `fig:r-prove` | 3.3 | loại proof, ngưỡng năm, thời gian tạo proof |
| `fig:r-verify-ok` | 3.3 | năm dấu xanh, chuỗi cơ quan phát hành |
| `fig:r-counter` | 3.4 | hồ sơ người bán hợp lệ, nộp, hàng chờ |
| `fig:r-scope` | 3.4 | lỗi ngoài địa bàn |
| `fig:r-attack-window` | 3.5 | ngõ cụt `procedure-open`; bước 4 đỏ (`InvalidAttestation`) |
| `fig:r-operations` | 3.6 | trạng thái sổ, cảnh báo, hàng chờ theo đơn vị |
| `fig:r-superseded` | 3.7 | "Giấy chứng nhận không còn hiệu lực" |
| `fig:r-revoked` | 3.7 | 410 / "đã bị thu hồi"; sự kiện thu hồi có mã lý do, `rootVersion`, tx hash |
| `fig:r-lineage` | 3.8 | dòng thời gian sổ cũ → sổ mới |
| (thêm) Etherscan | 6 | giao dịch có event `PropertyRevoked`; trang `RootRegistry` |
| (thêm) Network | 5 | ô lọc `ownerSecret` = 0 kết quả |

Mỗi ảnh phải thấy dòng "Đơn vị: …" (trang cán bộ) hoặc thanh địa chỉ (trang resident).

---

## 8. Case tấn công: đã chứng minh tự động và phần còn xem trên giao diện

Đợt A6 (15/11) đã chạy các case này qua API, CLI và gọi thẳng contract, trên một registry 10 thửa ở Hardhat. Bằng chứng ở
`data/a6-attacks/`. Phần còn lại cho bạn là **nhìn và chụp** chúng trên giao diện, để Ch5 có ảnh và để bạn thấy người dùng
gặp gì.

| Case | Cơ chế chặn | Đã chứng minh tự động (file trong `data/a6-attacks/`) | Còn xem trên giao diện |
| --- | --- | --- | --- |
| (a) Bán hai lần trong lúc chờ đợt vào sổ | Hồ sơ mở → backend không ký xác nhận tình trạng | `c-transfer-smoke.txt`: "seller attestation refused (409 ProcedureOpen)" | Mục 3.5, ảnh `fig:r-attack-window` |
| (b) Chủ bị thu hồi đem sổ đi vay | Như (a) | `b-proof-bodies-open.txt` (xác nhận bị từ chối); `b-verify-open.txt` (422 `InvalidAttestation`); `b-chain-open.txt` (contract revert `AttestationExpired`) | Mục 3.6, UC-5 với 1003 |
| (c) Chủ cũ sau đợt vào sổ | Lá đổi chủ → root mới; secret cũ không mở cam kết mới | `c-verify-before-round.txt` (trước đợt: hợp lệ cả 5 bước); `c-verify-after-round.txt` + `c-chain-after-round.txt` (sau đợt: `RootMismatch` ở backend và contract); `c-old-owner-smoke.txt` (lá đã đổi, prover dừng); `c-new-owner-smoke.txt` (người mua prove được) | Mục 3.7, ảnh `fig:r-superseded` |
| (d) Thửa đã thu hồi | Lá bị gỡ khỏi cây | `d-proof-203.txt` (410); `d-isRevoked.txt` (`isRevoked(203) = true`); `d-history-203.json` (REVOKED ở v3, mã lý do 1 + băm, không có văn bản); `d-owner-smoke-203.txt` (dừng ở 410); đợt 1 thu hồi tốn 92.008 gas | Mục 3.7, ảnh `fig:r-revoked` |
| (e) Phát lại proof cũ | Luật tươi 10 phút | `e-verify-stale-offchain.txt`, `e-verify-stale-onchain.txt` (`StaleTimestamp`, 666 s); `e-chain-stale.txt` (contract `StaleTimestamp`, 674 s); cùng proof lúc mới tạo thì contract nhận (`e-chain-fresh.txt`) | UC-6 dán proof cũ hơn 10 phút (PHASE_9 §3.8) |
| (f) Sửa hồ sơ trong receipt | `offchainHash` nằm trong lá | `f-tamper.txt`: `receipt:verify` hỏng đúng một mục "record matches the certified leaf — ALTERED", 9 mục khác vẫn xanh; `owner:smoke` dừng ở ràng buộc của circuit | UC-5 ô "Thông tin trên giấy đúng như lúc được cấp" đỏ (PHASE_9 §3.4) |
| (g) Cơ quan phát hành giả cùng tên | Chuỗi D30, CA gốc ghim sẵn | Test frontend `issuer-chain.test.ts` (12/11, 401/401 pass) | UC-6 tab Thẩm tra (PHASE_9 §3.6) |
| (h) Chi nhánh làm ngoài địa bàn | D86 | Spec backend `office-scope.spec.ts` (505/505 pass) | Mục 3.4, ảnh `fig:r-scope` |
| (i) Chuyển nhượng đất cộng đồng | Điều 39 | Chưa có bằng chứng riêng | DEMO_SEPOLIA §8.4 bước 4 |
| (j) Ví không có quyền publish | `STATE_AUTHORITY_ROLE` | Test contract "rejects a caller without STATE_AUTHORITY_ROLE" (`data/phase1/tests-blockchain.txt` dòng 125, 139) | Mục 3.9 |
| (k) Thu hồi một thửa hai lần | `AlreadyRevoked` | Test contract "rejects revoking the same property twice" (dòng 123) | Không cần |
| (l) Từ chối hồ sơ là mở khoá | Hồ sơ đóng → xác nhận lại được ký | Chưa có bằng chứng riêng | Mục 3.9 |
| (m) API công khai lộ hồ sơ | D50 | `data/attacks/m-public-api.txt` | Không cần |
| (n) Quét API | Giới hạn 60 request/phút | `n-throttle.txt`: 70 request dồn → 60 × 200, 10 × 429 | Không cần |

**Phát hiện khi chạy A6: xác nhận tình trạng mới ký có thể bị contract từ chối trong khoảng một block.** Backend đặt
`expiresAt = giờ máy + 600 s`, đúng bằng trần; contract chỉ chấp nhận khi `expiresAt ≤ block.timestamp + 600`. Khi block
mới nhất cũ hơn lúc ký, contract báo `InvalidAttestation` dù chữ ký đúng (`e-verify-fresh.txt`: backend nhận, contract từ
chối; đào thêm một block thì contract nhận: `e-chain-fresh.txt`). Trên Hardhat, cửa sổ này kéo dài tới giao dịch kế tiếp;
trên Sepolia/mainnet là tối đa khoảng một block (~12 s) cộng độ lệch đồng hồ của server. Hướng sửa: ký với hạn ngắn hơn
trần một chút, hoặc cho contract một khoảng lệch nhỏ. Code chưa sửa.

---

## 9. Phía thesis (M7)

- Gửi link các bài báo cho hai ước tính TP.HCM (2,5 triệu thửa; 4,5 triệu giấy chứng nhận). Trong thesis luôn viết là
  ước tính.
- Câu "tested end to end" trong abstract chỉ giữ sau khi xong M1 và M2.
- Mỗi số trích trong Ch5 cần `% src:` trỏ vào file trong `benchmarks/2026-11-12-hcmc-4.5M-final/data/` (đã commit được).

---

## 10. Bảng ghi số (điền khi làm)

| Đo | Giá trị | Ghi chú |
| --- | --- | --- |
| Gas đợt #1 (4 cấp mới, local) | | |
| Gas đợt #2 (1 chuyển nhượng + 1 thu hồi) | | |
| Gas đợt #3 (1 cấp mới + 1 thu hồi) | | |
| Gas đợt #4 (2 cấp mới) | | |
| Số chữ ký MetaMask cả kịch bản | | kỳ vọng 4 (5–6 nếu làm Bước 10) |
| Thời gian bấm "Tạo đợt vào sổ" → thấy nháp | | |
| Thời gian `seed:land-offices` | | |
| Thời gian proof trong browser | | bảng mục 4 |
| Sepolia: tx hash, `rootVersion`, phí từng đợt | | mục 6 |

---

## 11. Dọn dẹp sau khi làm

- Xoá thư mục giải nén ZIP (có `secret.json`).
- Các DB bench trong Docker (xem `README.md` §11.3) có thể xoá khi không cần chạy lại.
- Trả `web-app/backend/.env` về cấu hình bạn dùng thường ngày nếu đã đổi khoá cho local.
