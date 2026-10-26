# Phase 10 — Hướng dẫn tự kiểm thử thủ công (đợt vào sổ hợp nhất, 41 đơn vị, trang điều hành)

> ⚠️ **Trạng thái: chưa chạy thật.** Runbook viết ngày 15/10/2026 cùng lúc với code, **chưa được
> thực hiện trọn một lượt** — cần một người thao tác ba trình duyệt và Metamask. Phần tự động đã
> chạy: 401 test Vitest (43 file), 503 test Jest backend (49 suite), `eslint` frontend,
> `next build` và `nest build`; blockchain không đổi (contract và circuit không bị chạm, 183 test).
> Khi chạy xong, sửa dòng này và ghi số đo thật vào mục 5.

Đây là DoD của Phase 10 (`CODING_ROADMAP.md` §4): **ba vai (chi nhánh CN01, chi nhánh CN02, trung tâm)
đi hết kịch bản §11 của spec — cấp mới, chuyển nhượng, thu hồi, thay sổ — chỉ qua UI, với đúng ràng
buộc địa bàn, một `rootVersion` cho mọi thứ trong một đợt, và lịch sử mảnh đất không đứt khi đổi
`propertyId`.** Spec: `docs/superpowers/specs/2026-10-14-phase-10-operations-console-design.md`.

Quy tắc nghiệp vụ đang được kiểm (D83): hệ thống chỉ có ba thao tác ghi — **cấp mới**, **chuyển
nhượng**, **thu hồi**. Cấp đổi, tách thửa, hợp thửa, kết quả của toà án đều là *thu hồi sổ cũ + cấp
sổ mới mang `propertyId` mới*. Hai thủ tục độc lập, nhưng sổ mới khai nó thay cho sổ nào lúc import
(D90) và chỉ được đề nghị cấp khi sổ cũ đã `REVOKED` thật.

Mọi lệnh chạy từ thư mục gốc repo (`D:\thesis\land-registry-zkp`), trong **Git Bash**.

**Chỉ trình duyệt "trung tâm" cần Metamask.** Hai chi nhánh không ký gì: chuyển nhượng và thu hồi của
họ chỉ là hàng chờ. Nếu thấy chi nhánh bị đòi ví để làm việc thì đó là lỗi.

---

## 0. Các bẫy nên biết trước

Bốn bẫy của `PHASE_5_MANUAL_TEST.md` §0 và năm bẫy của `PHASE_8_MANUAL_TEST.md` §0 (a–e) vẫn đúng. Thêm:

**a) Khoá chi nhánh chỉ in ra một lần.** `seed:land-offices` in `CN01<tab>khoá`… rồi chỉ giữ hàm băm.
Lưu CN01 và CN02 ngay (mất thì `pnpm --filter backend run office:rotate-key CN01`). Trung tâm dùng
chính `GOV_API_KEY` trong `.env` (resolve thành `HQ`). Khoá `HQ`/`CS2`/`CS3` cũng được in ra; có thể
dùng `GOV_API_KEY` thay vì chúng.

**b) `migrate reset` xoá DB nhưng không xoá chain.** `hardhat node` giữ state trong RAM. Reset DB thì
**tắt và bật lại node + `deploy:localhost`** để hai bên cùng về mốc 0, nếu không `status` báo
`inSync: false` ngay từ đầu.

**c) Node để yên thì `block.timestamp` đứng im.** Phê duyệt chuyển nhượng (bước 5) sau khi node rảnh
>10 phút sẽ báo `StaleTimestamp` dù proof vừa tạo. Đào một block rồi phê duyệt lại:

```bash
curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}' http://127.0.0.1:8545
```

**d) Metamask nhớ nonce của chain cũ.** Sau mỗi lần bật lại node: Metamask → Settings → Advanced →
**Clear activity tab data**.

**e) `sessionStorage` theo tab, không theo trình duyệt.** Ba "người dùng" phải ở ba **profile Chrome
riêng** (hoặc hai cửa sổ ẩn danh + một cửa sổ thường), kẻo mở nhầm khoá. Ghi tên đơn vị trên thanh
trạng thái ("Đơn vị: …") vào mỗi lần chụp màn hình.

**f) Một thủ tục mở mỗi thửa (D80, D82).** Thửa có chuyển nhượng hoặc thu hồi đang mở sẽ không nhận
được xác nhận tình trạng; `/resident/proof` báo ngõ cụt "Giấy chứng nhận đang có thủ tục chưa hoàn
tất". Tạm giữ không làm mục thoát khỏi trạng thái "đang mở".

**g) Rate limit.** `GET /api/proof/:id` bị siết 12 request/phút (xem Phase 9 §0a); đừng nạp đi nạp
lại bundle.

**h) Gói hồ sơ chứa secret.** Các ZIP tải ở bước 2/7/8/9 chứa `secret.json`. Giải nén vào thư mục
riêng ngoài repo (ví dụ `D:\thesis\phase10-demo\`), không commit.

---

## 1. Chuẩn bị

### 1.1 Môi trường sạch

```bash
pnpm install
pnpm run compile                                   # typechain + ABI cho frontend, bắt buộc trước dev/build
pnpm run db:up                                     # Postgres, cổng 5433
pnpm --filter backend prisma migrate reset --force # xoá DB, áp migration Phase 10
pnpm --filter backend run db:generate
pnpm --filter backend run seed:admin-units DVHC_TPHCM.csv --province "TP.HCM"
pnpm --filter backend run seed:land-offices        # LƯU khoá CN01 và CN02 in ra (xem §0a)
pnpm --filter backend run cert:generate            # chứng thư X.509 của cơ quan (D30/D78); đã có thì giữ nguyên
```

- `seed:admin-units` chạy với thư mục `web-app/backend/`, nên đường dẫn `DVHC_TPHCM.csv` tương đối tới đó.
- `seed:land-offices` phải thấy dòng `Upserted 41 offices; assigned 168 communes.` và cuối cùng là bảng
  khoá. Nó thất bại toàn bộ nếu catalog và file lệch nhau — đó là kiểm tra, không phải lỗi.
- Artifact mật mã: nếu `blockchain/circuits/build/` đã có thì **không** chạy `circuits:setup` (nó sinh
  `.zkey` mới, lệch bộ verifier sắp deploy). Chỉ cần:

  ```bash
  pnpm --filter blockchain run circuits:sync-frontend   # 9 dòng "synced"
  ```

  Thư mục đó trống thì `pnpm --filter blockchain run circuits:setup` (mất vài phút).
- `web-app/backend/.env` cần: `CHAIN_NETWORK=localhost`, `RPC_URL=http://127.0.0.1:8545`,
  `AUTHORITY_PRIVATE_KEY` (khoá test Hardhat #0), `GOV_API_KEY`. Mẫu ở `.env.example`.
  `REVOCATION_CAP` và `QUEUE_STALE_DAYS` để trống (mặc định 150 và 2); bước 10 sẽ tạm hạ cap.

### 1.2 Khởi động (4 terminal)

| | Lệnh |
| --- | --- |
| T1 | `pnpm --filter blockchain run node` (để chạy suốt) |
| T2 | `pnpm --filter blockchain run deploy:localhost` (một lần, rồi dùng tiếp cho lệnh CLI) |
| T3 | `pnpm run dev:backend` — chờ 4 dòng như `PHASE_5_MANUAL_TEST.md` §2 |
| T4 | `pnpm run dev:frontend` — `http://localhost:3000` |

### 1.3 Metamask (chỉ profile trung tâm)

Mạng `http://127.0.0.1:8545`, Chain ID `31337`, ký hiệu `ETH`; import tài khoản bằng private key
Hardhat #0 (`0xac09…ff80` — khoá test công khai, không dùng ngoài localhost). Ví này phải là tài khoản
authority (`0xf39F…2266`).

### 1.4 Ba profile trình duyệt

| Profile | Khoá | Ví | Tên đơn vị kỳ vọng trên thanh trạng thái |
| --- | --- | --- | --- |
| **CN01** | khoá CN01 | không | `Đơn vị: Chi nhánh Văn phòng Đăng ký đất đai số 1` |
| **CN02** | khoá CN02 | không | `Đơn vị: Chi nhánh Văn phòng Đăng ký đất đai số 2` |
| **TT** (trung tâm) | `GOV_API_KEY` | Metamask #0 | `Đơn vị: Văn phòng Đăng ký đất đai TP.HCM — Trụ sở chính` |

Ở mỗi profile mở `http://localhost:3000/vi/government` → màn "Đăng nhập cán bộ địa chính" → ô "Khóa
truy cập" → **Tiếp tục**. Kỳ vọng:

1. Vào thẳng **Điều hành** (`/vi/government/operations`) — trang chủ, không còn là Nhập dữ liệu.
2. Thanh điều hướng theo phạm vi (D86):
   - **CN01 / CN02:** Điều hành · Chuyển nhượng · Thu hồi · Hồ sơ các đợt vào sổ.
   - **TT:** Điều hành · Nhập dữ liệu · Cấp giấy · Chuyển nhượng · Thu hồi · Chốt sổ · Hồ sơ các đợt vào sổ.
3. Ở CN01 gõ tay `/vi/government/import`, rồi `/vi/government/issuance`, rồi `/vi/government/changes`
   → mỗi trang hiện Notice vàng **"Chỉ trung tâm (trụ sở và các cơ sở) mới thực hiện được thao tác này.
   Chi nhánh thì không."** (`govErrors.centralScopeRequired`), không có form nào.
4. Khoá sai (tab ẩn danh): "Khóa truy cập không hợp lệ. Vui lòng thử lại."

### 1.5 Dữ liệu mẫu

Tạo thư mục ngoài repo và ba tệp CSV. Giá trị đã chọn để qua mọi bước kiểm của import (D35: mã đất,
tenure, cơ quan cấp, số seri `CT 1xxxxx`, địa chỉ đúng một phường/xã nằm trong catalog).

```bash
mkdir -p /d/thesis/phase10-demo && cd /d/thesis/phase10-demo

cat > 1-initial.csv <<'EOF'
propertyId,landUseCode,tenureType,landUserType,culturalPreservation,certificateSerial,bookEntryNumber,mapSheetNumber,landOrigin,address,area,issuingAuthority,issueDate,expiryDate,encumbranceStatus,isLongTermInvestmentProject,supersedesPropertyIds
1001,ONT,PERPETUAL,,,CT 101001,CS30001,1,Nhà nước công nhận quyền sử dụng đất,"Số 3, Đường Nguyễn Huệ, Phường Sài Gòn, TP.HCM",120.50,Sở Nông nghiệp và Môi trường TP.HCM,25/09/2021,,FREE,,
1002,ODT,PERPETUAL,,,CT 101002,CS30002,2,Nhà nước công nhận quyền sử dụng đất,"Số 228, Đường Võ Văn Ngân, Phường Thủ Đức, TP.HCM",85.20,Sở Nông nghiệp và Môi trường TP.HCM,24/09/2025,,FREE,,
1003,ODT,PERPETUAL,,,CT 101003,CS30003,3,Nhà nước công nhận quyền sử dụng đất,"Số 51, Đường Nguyễn Huệ, Phường Sài Gòn, TP.HCM",96.40,Sở Nông nghiệp và Môi trường TP.HCM,24/09/2024,,FREE,,
1004,ODT,PERPETUAL,,,CT 101004,CS30004,4,Nhà nước công nhận quyền sử dụng đất,"Số 186, Đường Võ Văn Ngân, Phường Thủ Đức, TP.HCM",85.20,Sở Nông nghiệp và Môi trường TP.HCM,26/09/2019,,FREE,,
EOF

cat > 2-successor-of-1003.csv <<'EOF'
propertyId,landUseCode,tenureType,landUserType,culturalPreservation,certificateSerial,bookEntryNumber,mapSheetNumber,landOrigin,address,area,issuingAuthority,issueDate,expiryDate,encumbranceStatus,isLongTermInvestmentProject,supersedesPropertyIds
1101,ODT,PERPETUAL,,,CT 101101,CS30101,1,Nhà nước công nhận quyền sử dụng đất,"Số 51, Đường Nguyễn Huệ, Phường Sài Gòn, TP.HCM",96.40,Sở Nông nghiệp và Môi trường TP.HCM,01/10/2026,,FREE,,1003
EOF

cat > 2b-bad-supersession.csv <<'EOF'
propertyId,landUseCode,tenureType,landUserType,culturalPreservation,certificateSerial,bookEntryNumber,mapSheetNumber,landOrigin,address,area,issuingAuthority,issueDate,expiryDate,encumbranceStatus,isLongTermInvestmentProject,supersedesPropertyIds
1301,ODT,PERPETUAL,,,CT 101301,CS30301,1,Nhà nước công nhận quyền sử dụng đất,"Số 60, Đường Lê Lợi, Phường Sài Gòn, TP.HCM",50.00,Sở Nông nghiệp và Môi trường TP.HCM,01/10/2026,,FREE,,9999
1302,ODT,PERPETUAL,,,CT 101302,CS30302,2,Nhà nước công nhận quyền sử dụng đất,"Số 62, Đường Lê Lợi, Phường Sài Gòn, TP.HCM",50.00,Sở Nông nghiệp và Môi trường TP.HCM,01/10/2026,,FREE,,1302
1303,ODT,PERPETUAL,,,CT 101303,CS30303,3,Nhà nước công nhận quyền sử dụng đất,"Số 64, Đường Lê Lợi, Phường Sài Gòn, TP.HCM",50.00,Sở Nông nghiệp và Môi trường TP.HCM,01/10/2026,,FREE,,1101
1304,ODT,PERPETUAL,,,CT 101304,CS30304,4,Nhà nước công nhận quyền sử dụng đất,"Số 66, Đường Lê Lợi, Phường Sài Gòn, TP.HCM",50.00,Sở Nông nghiệp và Môi trường TP.HCM,01/10/2026,,FREE,,abc
EOF

cat > 3a-split-d1.csv <<'EOF'
propertyId,landUseCode,tenureType,landUserType,culturalPreservation,certificateSerial,bookEntryNumber,mapSheetNumber,landOrigin,address,area,issuingAuthority,issueDate,expiryDate,encumbranceStatus,isLongTermInvestmentProject,supersedesPropertyIds
1201,ODT,PERPETUAL,,,CT 101201,CS30201,1,Nhà nước công nhận quyền sử dụng đất,"Số 188, Đường Võ Văn Ngân, Phường Thủ Đức, TP.HCM",42.60,Sở Nông nghiệp và Môi trường TP.HCM,10/10/2026,,FREE,,1004
EOF

cat > 3b-split-d2.csv <<'EOF'
propertyId,landUseCode,tenureType,landUserType,culturalPreservation,certificateSerial,bookEntryNumber,mapSheetNumber,landOrigin,address,area,issuingAuthority,issueDate,expiryDate,encumbranceStatus,isLongTermInvestmentProject,supersedesPropertyIds
1202,ODT,PERPETUAL,,,CT 101202,CS30202,2,Nhà nước công nhận quyền sử dụng đất,"Số 190, Đường Võ Văn Ngân, Phường Thủ Đức, TP.HCM",42.60,Sở Nông nghiệp và Môi trường TP.HCM,10/10/2026,,FREE,,1004
EOF
cd /d/thesis/land-registry-zkp
```

| Mã thửa | Vai trong kịch bản | Phường (→ chi nhánh) |
| --- | --- | --- |
| **1001** | **A** — được chuyển nhượng | Sài Gòn → CN01 |
| **1002** | **B** — chỉ để thấy CN02 có phần archive riêng | Thủ Đức → CN02 |
| **1003** | **C** — bị thu hồi (tranh chấp, `reasonCode 3`) | Sài Gòn → CN01 |
| **1004** | **D** — bị thu hồi để tách thửa | Thủ Đức → CN02 |
| **1101** | **C′** — thay C (cấp lại cho người được nhận đất) | Sài Gòn → CN01 |
| **1201, 1202** | **D1, D2** — hai thửa tách ra từ D | Thủ Đức → CN02 |

Ghi chú: lúc `seed:land-offices`, `Phường Sài Gòn` thuộc CN01 và `Phường Thủ Đức` thuộc CN02 (spec
Phụ lục A). Nếu `seed:admin-units` chưa chạy thì import vẫn chạy, nhưng mọi thửa rơi vào
"Chưa phân địa bàn" và bước 3 không còn ý nghĩa — làm lại §1.1.

---

## 2. Kịch bản

Số bước theo §11 của spec, trừ bước **6** và **7** đã **đổi chỗ** (kiểm thứ tự D90 phải làm *trước*
khi thu hồi C được công bố, nên nằm trước chốt sổ). Bước 10 là tuỳ chọn.

### Bước 1 — Trung tâm nhập dữ liệu và đề nghị cấp mới (UC-2 → UC-1, D87)

*Profile TT.*

1. **Nhập dữ liệu** → **Chọn tệp CSV** → `1-initial.csv`. Kỳ vọng:
   - Tiêu đề "Đã kiểm tra 1-initial.csv — sẵn sàng nhập"; `Dòng hợp lệ = 4`, `Dòng lỗi = 0`, `Cảnh báo = 0`.
   - Khối **"Theo chi nhánh"** (cột Chi nhánh / Số dòng): `CN01 = 2`, `CN02 = 2`, **không** có dòng "Chưa phân địa bàn".
   - Cột tuỳ chọn được giải thích ở khối "Cột tùy chọn: supersedesPropertyIds".
2. **Nhập 4 dòng hợp lệ** → "Đã nhập thành công 4 dòng" → **Sang cấp giấy**.
3. Trang **Cấp giấy** (không còn DraftPanel, D84). Mục "Thửa đất đã nhập" liệt kê 4 thửa. Chọn cả 4 →
   dưới bảng "Đã chọn 4 thửa" → **Đề nghị cấp**. Kỳ vọng:
   - Notice "Đã xếp 4 thửa vào hàng chờ cho đợt vào sổ tiếp theo". **Không** có ví, không có chữ ký.
   - Bảng "Đề nghị cấp đang chờ đợt vào sổ tiếp theo" có 4 dòng, cột **Chi nhánh**: 1001/1003 = `CN01`, 1002/1004 = `CN02`.
   - 4 thửa trong bảng chọn mang nhãn **"Đã xếp hàng"** và checkbox bị khoá.
4. **Rút lại** ở dòng 1004 → xác nhận "Rút lại đề nghị cấp thửa 1004? Khóa bí mật của chủ sở hữu sẽ bị
   hủy…" → **Xác nhận rút lại** → "Đã rút đề nghị cấp thửa 1004; thửa đất đã quay về danh sách nhập".
   Chọn lại 1004 → **Đề nghị cấp** (secret mới được sinh; secret cũ đã bị huỷ). Bảng lại có 4 dòng.
5. **Kiểm rò secret (D50/D77/D87).** Với `$HQ` là `GOV_API_KEY`:

   ```bash
   HQ=<GOV_API_KEY>
   curl -s -H "x-gov-api-key: $HQ" "http://localhost:3001/api/government/issuance-requests?status=READY" | grep -c "ownerSecret"
   curl -s -H "x-gov-api-key: $HQ" "http://localhost:3001/api/government/queue" | grep -c -E "ownerSecret|newOwnerSecret|detailText"
   ```

   Cả hai phải in **0**: secret nằm trên dòng `IssuanceRequest` nhưng không route nào được trả nó ra.
6. **Điều hành** (TT): bảng "Hàng chờ theo đơn vị" — dòng `CN01`: **Cấp mới = 2**; `CN02`: **Cấp mới = 2**;
   mọi cột khác bằng 0; "Cũ nhất" nhỏ hơn một giờ. Bấm tiêu đề cột để sắp xếp ("Sắp xếp theo Cấp mới")
   → CN01 và CN02 lên đầu. Khối "Sổ đăng ký": "Chưa công bố root nào", bản nháp đang mở "Không có".
   Mục "Cảnh báo": **"Không có việc nào cần chú ý."**
7. **Điều hành** (CN01): chỉ thấy bảng "Hàng chờ của đơn vị" một dòng của riêng CN01 — không thấy CN02.

### Bước 2 — Chốt sổ đợt #1 và archive theo chi nhánh (UC-1, D84, D88)

*Profile TT.*

1. **Chốt sổ**. Mục "Đợt vào sổ này": bảng "Theo nghiệp vụ" `Cấp giấy = 4`, `Chuyển nhượng = 0`,
   `Thu hồi = 0`; bảng "Theo văn phòng" `CN01: 2 / 0 / 0`, `CN02: 2 / 0 / 0`. Không cảnh báo chặn.
2. **Tạo đợt vào sổ** → khối **"Bản nháp đợt vào sổ #1"**, dòng "4 yêu cầu cấp giấy", các cảnh báo (tệp lưu trữ
   chứa secret, bằng chứng tự đồng bộ). Chưa kết nối ví → bước "Kết nối ví cán bộ…" → **Kết nối ví** →
   chọn account #0.
3. **Ký và công bố đợt vào sổ** → Metamask hiện `publishRoot` → xác nhận → "Đang chờ giao dịch xác
   nhận trên chuỗi…" → "Đang cập nhật vào hệ thống…" → Notice **"Đợt vào sổ #1 đã công bố (v1)"**.
   Thanh trạng thái → `Gốc v1`. Bảng "Lịch sử các đợt vào sổ" có đợt #1 `Đã công bố`.
   *(Ví hỏng giữa chừng: dùng `NEW_ROOT=<root của nháp> pnpm --filter blockchain run sign:root` như
   `PHASE_8_MANUAL_TEST.md` §3.3, rồi tải lại trang và bấm **Xác nhận bản nháp**.)*
4. **Hồ sơ các đợt vào sổ** (TT): **hai dòng** cho đợt `#1 · v1` — `CN01` (2 thửa) và `CN02` (2 thửa) —
   cùng trạng thái **"Chờ tải về"** và cột "Hết hạn sau" ≈ `6 ngày 23 giờ`. Cảnh báo đầu trang nói rõ
   gói chứa `secret.json`.
5. **CN01 chỉ lấy được phần của mình.**
   - Profile **CN01** → **Hồ sơ các đợt vào sổ**: chỉ **một** dòng (`CN01`, đợt #1). **Tải ZIP** →
     tệp `round-1-CN01.zip`. Dòng chuyển sang **"Đã tải về"**, "Tải lần đầu <ngày giờ>" (không có "thay thế").
   - Giải nén vào `D:\thesis\phase10-demo\round-1\` : phải có thư mục `1001\` và `1003\` (mỗi cái có
     `receipt.json`, `secret.json`, PDF…) và `manifest.json` ghi `officeCode: "CN01"`, `kind: "issued"`.
     **Không** có `1002\`, `1004\`.
   - Thử lấy phần của CN02 bằng khoá CN01 (UI không cho vì không có dòng đó, nên gọi thẳng API):

     ```bash
     CN01=<khoá CN01>
     curl -s -i -H "x-gov-api-key: $CN01" "http://localhost:3001/api/government/changesets/1/archives/CN02" | head -n 12
     ```

     Kỳ vọng `HTTP/1.1 403` và body có `"reason":"OutsideOfficeArea"`.
6. **Trung tâm dự phòng (D88, Q3).** Profile **TT** → Hồ sơ các đợt vào sổ → **Tải ZIP** ở dòng `CN02`
   (`round-1-CN02.zip`) → dòng đó thành **"Đã tải về"**, "Tải lần đầu <ngày giờ> **bởi HQ (thay thế)**".
   Giải nén vào `round-1\` → thêm `1002\`, `1004\`.
7. Profile **CN02** → Hồ sơ các đợt vào sổ → **Tải ZIP** phần của mình → vẫn tải được. Dòng **không đổi**
   dòng chữ "bởi HQ (thay thế)": hệ thống chỉ ghi **lần tải đầu** (đây là giới hạn đã chốt, ghi ở §6).
8. **Điều hành** (TT) → "Đợt vào sổ gần đây": `#1 · v1` · "4 cấp mới · 0 chuyển nhượng · 0 thu hồi" ·
   **"Hồ sơ đã tải" = 2/2** · cột Gas có số (đọc `eth_getTransactionReceipt` ở trình duyệt, chỉ để hiển thị) ·
   mã giao dịch. "Cơ sở dữ liệu và chuỗi khối: **Khớp nhau**". Bảng hàng chờ trở về toàn 0.
9. Kiểm một bundle bằng CLI (chuỗi D30 + root on-chain):

   ```bash
   pnpm --filter blockchain run receipt:verify /d/thesis/phase10-demo/round-1/1001/receipt.json
   ```

### Bước 3 — Ràng buộc địa bàn của chuyển nhượng (UC-3, D83, D86)

1. **CN02 thử chuyển nhượng thửa của CN01** (`403 OutsideOfficeArea`). Profile **CN02** → **Chuyển nhượng**
   → "Quầy tiếp nhận chuyển nhượng" → **Chọn tệp hồ sơ** → chọn `round-1\1001\receipt.json` và
   `secret.json` (hoặc ZIP của thư mục `1001\`) → "Đã xác minh hợp lệ thửa đất 1001" (bước kiểm hồ sơ vẫn xanh vì
   chỉ đối chiếu leaf và secret) → để ô thời hạn là `0` → **Tạo bằng chứng và nộp hồ sơ**.
   Kỳ vọng: dừng ở "Đang chuẩn bị hồ sơ…" rồi hiện Notice đỏ **"Thửa đất này thuộc địa bàn của chi nhánh
   khác. Chỉ chi nhánh đó hoặc trung tâm mới xử lý được."** (`govErrors.outsideOfficeArea`). **Không** có
   bước "Đang tạo bằng chứng chuyển nhượng…" và hàng chờ "Chờ duyệt" vẫn trống.
2. **CN01 chuyển nhượng thửa của mình.** Profile **CN01** → **Chuyển nhượng** → cùng hồ sơ `1001` → **Tạo
   bằng chứng và nộp hồ sơ** → "Đang chuẩn bị hồ sơ…" → "Đang tạo bằng chứng chuyển nhượng…" (**ghi thời gian** vào §5)
   → **"Hồ sơ chuyển nhượng #1 đã gửi duyệt"**. Không có chữ ký ví nào.
3. Mục "Hàng chờ phê duyệt" → tab **Chờ duyệt**: hồ sơ #1, thửa `1001`, cột **Chi nhánh = CN01**, **không** có nhãn "Dự phòng".
   **Chưa bấm Phê duyệt** — để nó PENDING cho bước 5.
4. **Kiểm Network** (DoD của Phase 8 §3.4 vẫn đúng): tìm `ownerSecret` của `secret.json` bên bán trong
   mọi request → **0 kết quả**. Chỉ `POST /api/transfers/preview`, `POST /api/transfers` đi ra.
5. (Tuỳ chọn) Người bán mở `/vi/resident/proof` với bundle `1001\` → ngõ cụt **"Giấy chứng nhận đang có
   thủ tục chưa hoàn tất"** (D82).

### Bước 4 — Chi nhánh lập thu hồi (UC-4, D45, D83)

*Giả lập một vụ tranh chấp trên thửa C = 1003.*

1. Profile **CN01** → **Thu hồi**. Đoạn ghi chú dưới tiêu đề nói rõ cấp đổi/tách/hợp/kết quả toà án
   không phải thao tác riêng: *hãy thu hồi giấy cũ tại đây, sau đó trung tâm cấp giấy mới với mã thửa
   mới và khai báo giấy này là giấy bị thay thế.*
2. Điền: **Mã thửa đất** `1003` · **Lý do** "Tranh chấp hoặc theo bản án tòa án" · **Căn cứ quyết định**
   `Quyết định số 123/2026/QĐ-TA — tạm dừng giao dịch do tranh chấp` → **Đưa vào hàng chờ**.
   Kỳ vọng: "Đã đưa đề nghị thu hồi thửa 1003 vào hàng chờ" + dòng "Mã băm chi tiết: 0x…".
3. Bảng "Thu hồi đang chờ đợt vào sổ tiếp theo": 1 dòng, Chi nhánh `CN01`, có cột "Chi tiết (ngoài chuỗi)"
   và "Mã băm (trên chuỗi)". Dòng chú thích: "Mỗi đợt xử lý tối đa 150 yêu cầu thu hồi…".
4. **Các lỗi địa bàn / xung đột cần thấy:**

   | Thao tác | Kỳ vọng |
   | --- | --- |
   | CN01 lập thu hồi thửa `1002` (của CN02) | Notice đỏ `govErrors.outsideOfficeArea` |
   | CN02 lập thu hồi thửa `1003` (của CN01) | Notice đỏ `govErrors.outsideOfficeArea` |
   | CN01 lập thu hồi thửa `1001` (đang có chuyển nhượng PENDING) | Notice `govErrors.conflict` ("Yêu cầu xung đột với trạng thái hiện tại"); D80: một thủ tục mở mỗi thửa |
   | CN01 lập thu hồi `1003` lần hai | `govErrors.conflict` |

5. **Rút lại / lập lại** (D87): ở dòng 1003 bấm **Rút lại** → "Rút lại đề nghị thu hồi thửa 1003? Giấy chứng
   nhận vẫn còn hiệu lực…" → **Xác nhận rút lại** → "Đã rút đề nghị thu hồi thửa 1003" → lập lại như mục 2.
   (Hồ sơ cũ thành `REJECTED`, thửa được mở khoá, hồ sơ mới là dòng mới.)

### Bước 5 — Cảnh báo `PendingTransfersWouldBreak` (D89)

1. Profile **TT** → **Điều hành**. Mục "Cảnh báo" phải có cảnh báo vàng:
   **"1 giao dịch chuyển nhượng của CN01 đang chờ duyệt; chốt sổ lúc này sẽ khiến chúng không còn hợp lệ."**
   Bảng hàng chờ: `CN01` — Chuyển nhượng `1`, Thu hồi `1`.
2. *(Cần xác nhận.)* Profile **CN01** → **Điều hành** cũng thấy đúng cảnh báo đó (nó mang `officeCode` của
   CN01). Profile **CN02** → **Điều hành**: **không** thấy cảnh báo này.
3. Profile TT → **Chốt sổ**: bảng "Theo nghiệp vụ" chỉ có `Thu hồi = 1` (chuyển nhượng chưa APPROVED nên
   chưa vào đợt). Hiện **"Xem các cảnh báo sau trước khi chốt sổ"**, cảnh báo ở trên, checkbox
   **"Tôi đã xem các cảnh báo"**; nút **Tạo đợt vào sổ** bị khoá cho đến khi tick. **Đừng tạo đợt.**
4. Profile **CN01** → **Chuyển nhượng** → tab "Chờ duyệt" → **Phê duyệt** → "Đang xác thực trên blockchain…" →
   "Đã duyệt hồ sơ #1; sẽ công bố trong đợt vào sổ tiếp theo" (hồ sơ sang tab **Đã duyệt**, nhãn "Chờ đợt vào sổ tiếp theo").
   Gặp `StaleTimestamp` → đào block (§0c) rồi duyệt lại.
5. Điều hành (TT), sau vài giây: cảnh báo biến mất; "Cảnh báo" → "Không có việc nào cần chú ý." Bảng hàng chờ: CN01
   Chuyển nhượng `1` (đã duyệt), Thu hồi `1`.

### Bước 6 — Sổ thay thế phải đợi sổ cũ thu hồi xong (D90) *(spec bước 7a; làm trước khi chốt sổ)*

*Thu hồi 1003 đang `PENDING`, chưa publish.*

1. Profile **TT** → **Nhập dữ liệu** → `2-successor-of-1003.csv`: dry-run `Dòng hợp lệ = 1`, "Theo chi nhánh"
   `CN01 = 1`, không cảnh báo (1003 đang ISSUED nên hợp lệ làm giấy bị thay thế; chưa có giấy thay thế nào khác) →
   **Nhập 1 dòng hợp lệ**.
2. (Thứ tự này có chủ ý: `2b-…` cần 1101 đã có trong DB ở trạng thái `IMPORTED`.) Chọn **Chọn tệp khác** →
   `2b-bad-supersession.csv` (**chỉ xem dry-run, không nhập**).
3. Kết quả dry-run của `2b-…`: **`Dòng lỗi = 4`, hiện bảng "Các dòng bị lỗi"** với đúng bốn câu:

   | Dòng / thửa | Câu kỳ vọng (`govImport.rowCodes`) |
   | --- | --- |
   | 1301 | `PredecessorNotFound`: "Không có giấy chứng nhận **9999** trong hệ thống…" |
   | 1302 | `SelfSupersession`: "Một giấy chứng nhận không thể thay thế chính nó." |
   | 1303 | `PredecessorNeverIssued`: "Giấy chứng nhận **1101** mới được nhập, chưa từng được cấp nên không thể thay thế…" |
   | 1304 | `InvalidSupersedes`: "Giá trị supersedesPropertyIds không hợp lệ hoặc nằm ngoài phạm vi…" |

   Nút nhập không đề nghị nhập dòng nào (0 dòng hợp lệ). Không nhập gì.
4. **Cấp giấy** → chọn `1101` → **Đề nghị cấp**. Kỳ vọng: Notice đỏ **"Giấy chứng nhận mà giấy này thay thế
   chưa bị thu hồi. Hãy thu hồi giấy cũ và chốt sổ đợt đó trước."** (`govErrors.predecessorNotRevoked`,
   409). Bảng READY không có 1101. Đây là phép kiểm "kể cả thu hồi còn PENDING": 1003 đã có yêu cầu thu hồi
   nhưng chưa được công bố nên vẫn chặn.

### Bước 7 — Chốt sổ đợt #2: chuyển nhượng + thu hồi cùng một root (D84, D82)

*Profile TT.*

1. **Chốt sổ**: không còn cảnh báo; "Theo nghiệp vụ": `Cấp giấy = 0`, `Chuyển nhượng = 1`, `Thu hồi = 1`;
   "Theo văn phòng": `CN01: 0 / 1 / 1`. **Tạo đợt vào sổ**.
2. "Bản nháp đợt vào sổ #2": dòng "1 chuyển nhượng đã duyệt: #1", "1 thu hồi" + danh sách `1003 — Tranh chấp hoặc theo
   bản án tòa án`; cảnh báo "Quyết định thu hồi có hiệu lực vĩnh viễn trên blockchain…". Ký → Metamask hiện
   **`publishRootWithRevocations`** → xác nhận → **"Đợt vào sổ #2 đã công bố (v2)"**.
3. **Hồ sơ các đợt vào sổ**: đợt `#2 · v2` chỉ có **một** dòng `CN01` (1 thửa: gói của người mua 1001; thu
   hồi không sinh hồ sơ). Tải (CN01 hoặc TT) → giải nén vào `D:\thesis\phase10-demo\round-2\`: có `1001\`
   (bundle **của người mua**, `secret.json` mới), `manifest.json` có `kind: "transferred"`.
4. **Điều hành** → "Đợt vào sổ gần đây": `#2 · v2` · "0 cấp mới · 1 chuyển nhượng · 1 thu hồi" · "Hồ sơ đã tải" `0/1` hoặc `1/1`
   tuỳ bạn đã tải chưa · Gas.
5. **Kiểm kết quả trên chuỗi — mọi thứ cùng `rootVersion`:**
   - `/vi/resident/lookup` → `1001`: timeline có "Chuyển nhượng cho chủ mới", **Phiên bản 2**.
   - `/vi/resident/lookup` → `1003`: banner đỏ "Giấy chứng nhận này đã bị thu hồi", sự kiện "Thu hồi giấy chứng nhận",
     **Phiên bản 2**, "Lý do: Tranh chấp hoặc theo bản án tòa án" + "Mã băm chi tiết". Mở DevTools → Network
     → response của `/records/1003/lineage` **không có `detailText`** (D45).
6. **C không còn prove được:** `/vi/resident/proof` với `round-1\1003\` → màn **"Giấy chứng nhận này đã bị
   thu hồi"** (`residentErrors.revoked`), không bảng thông tin giấy, không nút Generate, không nút Thử lại.
7. **Người mua A prove được:** `/vi/resident/proof` với `round-2\1001\` → "Chứng minh quyền sở hữu thửa đất"
   → **Tạo bằng chứng** → **Tải proof.json** → `/vi/resident/verify` (tab "Xác minh thông thường") → dán →
   **Bắt đầu xác minh** → cả 5 check xanh, kết luận **"Hợp lệ (Chấp nhận)"**.
8. **Người bán cũ:** `/vi/resident/proof` với `round-1\1001\` → **"Giấy chứng nhận không còn hiệu lực"**
   (`supersededTitle`).
9. CLI (tuỳ chọn): `pnpm --filter blockchain run owner:smoke /d/thesis/phase10-demo/round-2/1001` → xanh.

### Bước 8 — Cấp C′ trên `propertyId` mới (D83, D90) và tạm giữ (D87)

*Cùng đợt này thu hồi D (1004) để chuẩn bị bước 9.*

1. Profile **TT** → **Cấp giấy** → chọn `1101` → **Đề nghị cấp** → lần này **thành công** (Notice "Đã xếp 1 thửa vào
   hàng chờ…"), vì 1003 đã `REVOKED` ở đợt #2.
2. **TT thu hồi D thay cho CN02 (dự phòng, D86).** TT → **Thu hồi**: `1004`, lý do "Phát hành sai sót, cấp đổi",
   căn cứ `Cấp đổi để tách thửa`. Dòng trong bảng chờ mang nhãn **"Dự phòng, do HQ nộp"** và Chi nhánh `CN02`.
   Điều hành: dòng `CN02` cột **Dự phòng = 1**.
3. **Tạm giữ (D87).** TT → **Chốt sổ**, bảng "Hồ sơ đang chờ": dòng thu hồi 1004 → **Tạm giữ** → ô "Lý do tạm giữ
   (1-500 ký tự)" → `thử tạm giữ` → xác nhận. Kỳ vọng: dòng mang trạng thái "Tạm giữ", mục "Đợt vào sổ này" chỉ còn
   `Cấp giấy = 1, Thu hồi = 0`; **Điều hành** có cảnh báo xanh **"1 mục đang được giữ lại, chưa vào đợt tới."**
   Thửa 1004 vẫn bị coi là "đang có thủ tục mở" (CN02 lập thu hồi 1004 lần nữa → `govErrors.conflict`).
   **Bỏ tạm giữ** → mục quay lại hàng chờ, cảnh báo biến mất, `Thu hồi = 1`.
4. **Tạo đợt vào sổ** → "Bản nháp đợt vào sổ #3", "1 yêu cầu cấp giấy" + "1 thu hồi". **Trước khi ký**, thử gỡ
   mục khỏi nháp đang mở (draft bất biến, D84):

   ```bash
   curl -s -H "x-gov-api-key: $HQ" "http://localhost:3001/api/government/queue?kind=revocation" | head -c 600
   curl -s -i -X POST -H "x-gov-api-key: $HQ" "http://localhost:3001/api/government/queue/revocation/<id>/withdraw" | head -n 12
   ```

   (`<id>` lấy từ danh sách trên.) Kỳ vọng `409` với `"reason":"ItemInOpenDraft"`; trên UI cùng lỗi là
   "Mục này đã nằm trong đợt vào sổ đang chuẩn bị…".
5. Ký → **`publishRootWithRevocations`** → **"Đợt vào sổ #3 đã công bố (v3)"**.
6. Giải nén archive đợt #3 (dòng `CN01`, 1 thửa) vào `round-3\` → `round-3\1101\`. Kiểm:
   - **UC-6 báo sổ C′ hợp lệ:** `/vi/resident/proof` với `round-3\1101\` → ownership proof → `/vi/resident/verify` →
     5 check xanh, **"Hợp lệ (Chấp nhận)"**.
   - **Sổ C vẫn hiện là đã thu hồi:** `/vi/resident/lookup` `1003` vẫn có banner thu hồi (Bước 7.5). Với proof
     của C cũ: xem `PHASE_9_MANUAL_TEST.md` §3.7 — không dựng lại ở đây vì mở thủ tục thu hồi đã chặn attestation (D82).
7. **Lịch sử mảnh đất, tra C′** (`/vi/resident/lookup` → `1101`): mục **"Lịch sử mảnh đất"** có **hai** mục theo thứ tự:
   - `Giấy chứng nhận 1003` (đời trước): "Đã được thay bằng **1101**" (nút bấm), sự kiện "Cấp giấy chứng nhận" (v1) và
     **"Thu hồi giấy chứng nhận" (v2) kèm "Lý do: Tranh chấp hoặc theo bản án tòa án"** — tức lần thu hồi mã 3 của C
     hiện ngay trên trang của C′;
   - `Giấy chứng nhận 1101` có nhãn **"Giấy chứng nhận bạn đang tra cứu"** và dòng **"Giấy chứng nhận này thay cho 1003"**,
     sự kiện "Cấp giấy chứng nhận" (v3).
   Bấm số `1003` → chuyển sang tra 1003, thấy "Đã được thay bằng 1101".
8. **Tra C** (`1003`): banner thu hồi + "Đã được thay bằng **1101**".

### Bước 9 — Tách thửa D → D1, D2 (D83, D90)

1. Profile **TT** → **Nhập dữ liệu** → `3a-split-d1.csv` (1004 đã `REVOKED` ở đợt #3 nên hợp lệ làm giấy bị thay thế) →
   dry-run `CN02 = 1`, không cảnh báo → nhập. Cấp giấy → `1201` → **Đề nghị cấp** → OK.
2. `3b-split-d2.csv` → dry-run: `Dòng hợp lệ = 1`, **`Cảnh báo = 1`**, bảng "Dòng có cảnh báo" với
   `PredecessorAlreadySucceeded`: "Giấy chứng nhận 1004 đã có giấy thay thế trong hệ thống. Điều này bình thường khi
   một giấy được tách thành nhiều giấy; dòng vẫn được nhập." Vẫn **Nhập 1 dòng hợp lệ**. Cấp giấy → `1202` → **Đề nghị cấp**.
3. **Chốt sổ** → đợt #4: `Cấp giấy = 2`, `CN02: 2 / 0 / 0` → ký → "Đợt vào sổ #4 đã công bố (v4)". Archive: chỉ dòng `CN02`
   (2 thửa). CN02 tải phần của mình.
4. **Tra D1** (`/vi/resident/lookup` → `1201`):
   - Có mục `Giấy chứng nhận 1004` (đời trước) với "Đã được thay bằng" **hai** số: `1201` và `1202`, và sự kiện
     "Thu hồi giấy chứng nhận" lý do "Phát hành sai sót, cấp đổi".
   - Mục `Giấy chứng nhận 1201` có nhãn "Giấy chứng nhận bạn đang tra cứu", "Giấy chứng nhận này thay cho 1004".
   - **Không có mục riêng cho `1202`** (không đi ngang sang anh em) — chỉ xuất hiện như một nút trong dòng "Đã được thay bằng" của 1004.
     Bấm `1202` → sang tra 1202.
5. **Tra D** (`1004`): `1201` và `1202` đều là mục đời sau.
6. Nếu `Truncated` được kích hoạt (chuỗi >200 nút) trang phải hiện "Chuỗi giấy chứng nhận bị cắt bớt" — không thể dựng bằng tay, đã có test.

### Bước 9b — Archive hết hạn không khoá Chốt sổ (D88, D89)

*Archive hết hạn mà chưa ai tải không tự hết cảnh báo, nên nó chỉ đòi tick xác nhận; chỉ `ChainAheadOfDatabase`
chặn hẳn việc tạo đợt.* Dùng archive `CN02` của đợt #4; lệnh SQL giả lập "đã hết hạn và chưa ai tải":

```bash
docker exec -i land_registry_postgres psql -U postgres -d land_registry -c \
  "UPDATE change_set_archives SET \"expiresAt\" = now() - interval '1 day', \"firstDownloadedAt\" = NULL, \"firstDownloadedByOfficeId\" = NULL WHERE \"changeSetId\" = 4;"
docker exec -i land_registry_postgres psql -U postgres -d land_registry -c \
  "SELECT \"changeSetId\", \"officeId\", zip IS NOT NULL AS has_zip FROM change_set_archives WHERE \"changeSetId\" = 4;"
```

Lệnh thứ hai phải in `has_zip = t` (bản trên máy chủ chưa bị xoá).

1. Profile **TT** → **Điều hành**: cảnh báo đỏ **"Hồ sơ đợt #4 của CN02 đã hết hạn mà chưa được tải; các giấy chứng
   nhận đó phải cấp lại."** Trang điều hành không xoá gì: chạy lại lệnh SELECT vẫn `has_zip = t`.
2. Profile **CN02** → **Thu hồi** `1202`, lý do "Hết hạn sử dụng, không gia hạn" (chỉ để hàng chờ có một mục).
3. Profile **TT** → **Chốt sổ**: hiện **"Xem các cảnh báo sau trước khi chốt sổ"** (không phải "Chưa thể chốt sổ"),
   danh sách có cảnh báo archive hết hạn, checkbox **"Tôi đã xem các cảnh báo"**; nút **Tạo đợt vào sổ** chỉ mở sau khi
   tick. **Đừng tạo đợt.**
4. Profile **TT** → **Hồ sơ các đợt vào sổ**: dòng `#4 · CN02` có trạng thái **"Đã hết hạn"**, chú thích "Bí mật đã bị
   xoá; cần cấp lại các thửa này.", nút tải bị khoá. Chạy lại lệnh SELECT → **`has_zip = f`**: việc mở danh sách
   archive đã xoá bản trên máy chủ (lần chốt sổ kế tiếp cũng làm việc đó).
5. Dọn: Profile **CN02** → **Thu hồi** → **Rút lại** đề nghị thu hồi 1202 (bước 10 cần lại thửa này). Cảnh báo archive
   hết hạn vẫn còn mãi — đúng thiết kế, phản hồi của cán bộ là tick xác nhận.

### Bước 10 (tuỳ chọn) — Tồn đọng thu hồi và `REVOCATION_CAP`

Chỉ làm khi cần kiểm `RevocationBacklog` và cap. Đặt `REVOCATION_CAP=1` trong `web-app/backend/.env`,
**khởi động lại backend** (T3). Hai thửa còn dư là `1201`, `1202` (cùng CN02):

1. Profile **CN02** → **Thu hồi**: `1201` rồi `1202`, lý do "Hết hạn sử dụng, không gia hạn", căn cứ tuỳ ý.
2. **Điều hành** (TT): cảnh báo vàng **"Đang có 2 thu hồi chờ; sổ cần khoảng 2 đợt để vào hết."**; dưới bảng hàng chờ:
   "Sổ cần khoảng 2 đợt để vào hết các thu hồi này."
3. **Chốt sổ**: "Có 1 thu hồi vượt giới hạn 1 mỗi đợt, sẽ chờ đợt sau." → cần tick xác nhận cảnh báo → **Tạo đợt vào sổ** →
   nháp ghi "Còn 1 thu hồi chờ đợt sau (tối đa 1 mỗi đợt)." → ký → công bố → Notice "Còn 1 thu hồi chờ đợt sau." và
   nút **Tạo đợt tiếp** → bấm, ký lần hai → hàng chờ về 0. (Đây là "một phiên chốt sổ gồm nhiều đợt".)
4. Trả `REVOCATION_CAP` về trống và khởi động lại backend.

---

## 3. Kiểm tra chéo cuối kịch bản

| Việc | Kỳ vọng |
| --- | --- |
| `curl -s http://localhost:3001/api/records/1101/lineage` (không khoá) | `nodes` có 1003 (`generation:-1`) và 1101 (`0`); key-set của node không có `detailText`, không có secret |
| Lệnh rò secret của hàng chờ (ngay dưới bảng) | `0` |
| `curl -s -H "x-gov-api-key: $CN01" http://localhost:3001/api/government/operations/offices` | 403 `CentralScopeRequired` |
| `curl -s -i -X POST -H "x-gov-api-key: $CN01" http://localhost:3001/api/government/changesets` | 403 `CentralScopeRequired` |
| CN01 `POST /api/government/issuance-requests` | 403 `CentralScopeRequired` |
| CN01 `POST /api/government/import` (kèm một CSV bất kỳ) | 403 `CentralScopeRequired`, không đọc tệp |
| `status` của backend (`GET /api/government/status`) | `inSync: true`, `chainId: 31337` |
| Trạng thái DB: `rootVersion` | 4 (hoặc 5–6 nếu làm bước 10); khớp `Gốc vN` trên thanh trạng thái |
| `pnpm --filter blockchain run chain:smoke:localhost` | xanh |

Lệnh rò secret của hàng chờ (để ngoài bảng vì dấu `|` trong bảng Markdown phải escape):

```bash
curl -s -H "x-gov-api-key: $HQ" http://localhost:3001/api/government/queue | grep -c -E "ownerSecret|newOwnerSecret|detailText"
```

---

## 4. Kết quả mong đợi (DoD)

| Điều kiện DoD | Bước |
| --- | --- |
| Đăng nhập bằng khoá theo đơn vị; nav theo phạm vi; trang chi nhánh gõ tay bị chặn (D86) | 1.4 |
| Import ghi đúng chi nhánh theo phường/xã và báo theo chi nhánh (D85) | 1 |
| Đề nghị cấp là hàng chờ, không ký; rút lại huỷ secret (D87) | 1 |
| Một đợt vào sổ gom cả cấp mới, chuyển nhượng, thu hồi dưới **một** root (D84) | 2, 7, 8 |
| Archive tách theo chi nhánh; chi nhánh chỉ tải phần mình; trung tâm tải được mọi phần; ghi lần tải đầu (D88) | 2 |
| Chuyển nhượng và thu hồi ngoài địa bàn bị `OutsideOfficeArea` (D86); trung tâm dự phòng ghi nhận | 3, 4, 8 |
| Cảnh báo `PendingTransfersWouldBreak`; Chốt sổ đòi tick cảnh báo (D89) | 5 |
| Archive hết hạn chỉ đòi tick, không khoá Chốt sổ; bản trên máy chủ bị xoá khi mở danh sách archive (D88, D89) | 9b |
| Sổ thay thế chỉ được đề nghị cấp khi sổ cũ đã `REVOKED` thật (D90) | 6 |
| Lỗi import `supersedesPropertyIds` đúng bốn mã và cảnh báo `PredecessorAlreadySucceeded` | 6, 9 |
| C không prove được sau thu hồi; người mua A prove được; mọi thứ cùng `rootVersion` | 7 |
| `/resident/lookup` thấy lịch sử xuyên qua đổi `propertyId`, không đi ngang sang anh em, không `detailText` | 8, 9 |
| Tạm giữ loại mục khỏi nháp nhưng vẫn khoá thửa; nháp bất biến (`ItemInOpenDraft`) | 8 |
| Không có secret / `detailText` trong response của route hàng chờ và lineage | 1, 3 |
| Cap thu hồi từ env; nhiều đợt trong một phiên (tuỳ chọn) | 10 |

---

## 5. Số đo cần ghi

| Đo | Giá trị |
| --- | --- |
| Transfer proof trong browser (bước 3.2) | *chưa đo* |
| Gas đợt #1 (4 cấp mới) | *chưa đo* |
| Gas đợt #2 (1 chuyển nhượng + 1 thu hồi) | *chưa đo* |
| Gas đợt #3 (1 cấp mới + 1 thu hồi) | *chưa đo* |
| Số chữ ký Metamask cho cả kịch bản | *chưa đo* (kỳ vọng 4) |
| Thời gian `Tạo đợt vào sổ` (bấm → thấy nháp) | *chưa đo* |
| Thời gian `seed:land-offices` | *chưa đo* |

---

## 6. Giới hạn cần nêu trong thesis (Limitations)

Sao từ spec Phase 10 (§6.2, §8, §9, §2.1, §6.5) và D83, ghi ra thay vì để tưởng là đã xong.

1. **Giữ secret (D42, D77, D87).** Secret của chủ mới nằm trong DB từ lúc *đề nghị cấp* (cấp mới) hoặc lúc *nộp hồ sơ*
   (chuyển nhượng) đến lúc đợt được confirm — khoảng một ngày trong quy trình chuẩn, tối đa 7 ngày nếu archive chưa
   được tải (`ARCHIVE_TTL_DAYS`). Cán bộ chi nhánh tải archive nên giữ secret của chủ thửa thuộc địa bàn mình trong
   lúc bàn giao. Đây là mức D77 đã chấp nhận cho người mua; D87 không mở thêm loại rủi ro mới nhưng kéo dài cửa sổ đó cho cấp mới.
2. **Trung tâm dự phòng (D88).** Trung tâm tải được archive của mọi chi nhánh, nên giới hạn D42 chỉ được *thu hẹp*, chưa
   mất. Hệ thống chỉ ghi **lần tải đầu** của mỗi phần: chi nhánh tải trước rồi trung tâm tải lại thì lần sau không được ghi.
   Archive hết hạn mà chưa ai tải thì secret bị xoá và các thửa đó phải cấp lại với `propertyId` mới (D83). Bản trên máy
   chủ được xoá ở lần chốt sổ hoặc lần mở danh sách archive kế tiếp sau khi hết hạn (hoặc khi có người thử tải phần đó),
   không phải đúng lúc hết hạn — trong khoảng đó secret vẫn nằm trong DB.
3. **Định danh theo đơn vị, không theo người (D86).** Khoá API tĩnh mỗi đơn vị (băm sha256), chưa có tài khoản cán bộ,
   OIDC hay VNeID, nên không có nhật ký theo từng người. `Actor` đã chừa chỗ: đổi cơ chế đăng nhập chỉ là thay resolver.
4. **Chuỗi thay thế (D90) là dữ liệu của cơ quan đăng ký, không phải dữ liệu chứng minh được bằng mật mã.** Liên kết chỉ nằm
   trong DB (`PropertyLineage`), không vào lá, không vào `offchainHash`, không in lên PDF (đưa vào `offchainHash` sẽ đổi định
   dạng metadata và làm mọi receipt đã phát hành không còn khớp). Liên kết cũng **công khai**: ai có id cũ lần theo được tới id mới.
5. **Thay sổ không nguyên tử (D83, D90).** D90 ép thu hồi publish trước, cấp mới sau, nên luôn có ít nhất một đợt mà không sổ
   nào của mảnh đất chứng minh được — hướng hỏng an toàn, trùng quy trình ngoài đời (xoá sổ cũ trước, cấp sổ mới sau).
   Lỗ hổng còn lại: nếu import **không khai** `supersedesPropertyIds` thì hệ thống không biết hai sổ cùng một mảnh đất và không
   chặn được trường hợp cả hai cùng hiệu lực.
6. **Cap thu hồi và nhu cầu ~950 hồ sơ/ngày (D56, D73, §6.5).** `REVOCATION_CAP` mặc định 150 (đo trên Hardhat); trên Sepolia sau
   Glamsterdam mỗi thu hồi ~448k gas nên phải đặt ≤ 60. Nhu cầu ~950/ngày nghĩa là một phiên chốt sổ gồm *nhiều đợt nối tiếp*;
   trang điều hành chỉ làm tồn đọng hiện ra rõ. Lời giải thật là gói struct `Revocation` — một quyết định contract riêng, kèm redeploy.
7. **Tạm giữ không đổi trạng thái.** Mục bị tạm giữ vẫn là READY / APPROVED / PENDING nên thửa vẫn "có thủ tục mở" (D80/D82):
   attestation vẫn bị từ chối cho tới khi mục được nhả hoặc rút.
8. **Chưa kiểm** trong runbook này: Sepolia (cap ≤ 60, RPC công khai), ba trình duyệt khác Chrome, nhiều cán bộ cùng thao tác
   trên một hàng chờ, ví Metamask thật ngoài Hardhat #0, bench `bench:month` sau khi đổi đường cấp lần đầu sang `issuance-requests`.
