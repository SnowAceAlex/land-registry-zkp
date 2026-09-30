# Phase 9 — Hướng dẫn tự kiểm thử thủ công (Resident portal)

> ⚠️ **Trạng thái: chưa chạy thật.** Runbook viết ngày 18/09/2026 cùng lúc với code, **chưa được
> thực hiện trọn một lượt** — mọi luồng ở đây cần một người thao tác trong trình duyệt thật.
> Phần tự động đã chạy: 187 test Vitest (gồm 5 test sinh **và** verify proof ownership + mortgage
> thật từ artifact trusted setup, và 4 test đối chiếu bản browser với bản Node của chuỗi danh tính
> D30 trên chứng chỉ thật), `next build`, lint, 195 test backend, 145 test blockchain. Khi chạy
> xong, sửa dòng này và ghi số đo thật vào mục 5.

Đây là DoD của Phase 9 (`CODING_ROADMAP.md` §4): **sinh + verify được cả 3 loại proof, UI phân biệt
rõ persona buyer/bank/government đang xem gì, và không có `ownerSecret`/private field nào lọt vào
network request** — kiểm bằng tab Network.

**Không cần Metamask ở bất kỳ bước nào trong runbook này.** Đó chính là điểm của D39/D49: người dân
và bên kiểm tra không đăng nhập, không có ví, không cài gì. Nếu thấy nút connect wallet trên trang
resident thì đó là lỗi biên giới bundle, không phải tính năng.

Mọi lệnh chạy từ thư mục gốc repo (`D:\thesis\land-registry-zkp`).

---

## 0. Các bẫy nên biết trước

Bốn bẫy của `PHASE_5_MANUAL_TEST.md` §0 và năm bẫy của `PHASE_8_MANUAL_TEST.md` §0 (a–e) vẫn đúng.
Thêm:

**a) `GET /api/proof/:propertyId` bị siết 12 request/phút.** Nạp đi nạp lại bundle trong lúc trình
bày sẽ ăn `429`. Đây là cố ý: một lần cache miss là dựng lại toàn bộ cây Merkle (D40). Màn hình đã
cache proof đã làm mới theo `propertyId` cho cả phiên, nên chỉ bấm "dùng bộ hồ sơ khác" mới gọi lại.

**b) Proof hết hạn sau ~10 phút (D26).** Một `proof.json` để quên rồi mới dán vào trang verify sẽ ra
`StaleTimestamp` — **đúng như thiết kế**, không phải lỗi. Sinh lại proof mới.

**c) Node để yên thì `block.timestamp` đứng im** (bẫy Phase 6/8). Ở Phase 9 nó ảnh hưởng **bước
kiểm tra thứ 4** (on-chain): 3 bước đầu đạt, bước 4 báo `StaleTimestamp`. Đào một block rồi thử lại:

```bash
curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}' http://127.0.0.1:8545
```

**d) `receipt.json` tiết lộ toàn bộ giấy chứng nhận.** Bước kiểm danh tính D30 (§3.6) cần nó, nên
trong vai **ngân hàng** thì **không** được đòi file này — trang cũng nói đúng điều đó. Chỉ dùng
receipt khi đóng vai người mua tại giao dịch chuyển nhượng hoặc cơ quan hậu kiểm.

**e) `CHAIN_NETWORK` của backend quyết định trang resident đọc chain nào.** Trang lấy `chainId` +
địa chỉ hợp đồng từ `GET /api/public/config` (D58). Nếu backend đang trỏ `sepolia` mà bạn chạy
`hardhat node` ở máy thì trang sẽ đọc Sepolia, không đọc node cục bộ. Kiểm bằng lệnh ở §2.

**f) Không có `NEXT_PUBLIC_` nào cấu hình trang resident.** Đừng đi tìm. Địa chỉ đến từ API; RPC thì
chọn theo `chainId` (`31337` → `http://127.0.0.1:8545`, `11155111` → `NEXT_PUBLIC_SEPOLIA_RPC_URL`
hoặc public RPC).

---

## 1. Chuẩn bị

1. Làm đủ `PHASE_8_MANUAL_TEST.md` §1 (a→g): `pnpm install`, `db:up`, migrate, `pnpm run compile`,
   `circuits:setup`, deploy, seed.
2. `pnpm --filter blockchain run circuits:sync-frontend` — phải thấy 9 tệp được copy vào
   `web-app/frontend/public/circuits/{ownership,mortgage,transfer}/`.
3. `pnpm run compile` — bắt buộc trước `dev`/`build`: `src/lib/contracts.ts` lấy ABI từ artifact của
   compiler, và `typechain-types/` bị gitignore.
4. **Có một bộ hồ sơ trong tay.** Chạy `PHASE_8_MANUAL_TEST.md` §3.2–§3.3 để cấp một đợt giấy rồi
   giải nén thư mục của một thửa (phải có `receipt.json` **và** `secret.json`), hoặc dùng lại thư
   mục từ lần chạy trước.
5. Đảm bảo `CHAIN_NETWORK` của backend trỏ đúng chain mà bước 4 đã cấp giấy.

---

## 2. Khởi động (4 terminal)

| | Lệnh |
| --- | --- |
| T1 | `pnpm --filter blockchain run node` |
| T2 | `pnpm --filter blockchain run deploy:localhost` (một lần, rồi thoát) |
| T3 | `pnpm run dev:backend` |
| T4 | `pnpm run dev:frontend` |

Smoke mới của Phase 9 — chạy trước khi mở trình duyệt:

```bash
curl -s http://localhost:3001/api/public/config
```

Phải trả về **đúng ba khoá** và **không có `rpcUrl`**:

```json
{"network":"localhost","chainId":31337,
 "contracts":{"RootRegistry":"0x5FbD…0aa3","LandRegistryVerifier":"0x…"}}
```

Nếu thấy `deployer`, khối `authority`, hay bất kỳ URL nào trong đó thì dừng lại — route đang rò dữ
liệu ra một trang không đăng nhập.

---

## 3. Kịch bản

### 3.1 D48 — `/vi/resident/lookup`

1. Tra một thửa **ISSUED**: hiện trạng thái, cam kết chủ sở hữu, hash lá, phiên bản gốc, và timeline
   có sự kiện `ISSUED` kèm `rootVersion` + mã giao dịch.
2. Đọc đoạn giải thích dưới bảng — phải nói rõ **vì sao** không có địa chỉ/diện tích/thời hạn ở đây
   (D50). Nếu nó chỉ hiện bảng trống mà không giải thích thì copy sai.
3. Tra một thửa **IMPORTED**: trạng thái "đã nhập, chưa cấp giấy", chưa có cam kết, chưa có lá.
4. Tra một thửa **đã thu hồi**: banner đỏ ở đầu trang nói **không proof nào tồn tại được**, timeline
   có sự kiện `REVOKED` với nhãn lý do (vd. "Tranh chấp / quyết định toà án") + `detailHash`.
   ⚠️ Mở DevTools → Network → xem response của `/records/<id>/history`: **không được có
   `detailText`** (D45/D48).
5. Nhập `1048576` (quá `MAX_PROPERTY_ID`) → báo lỗi ngay, **không** tốn request nào.
6. Nhập một id không tồn tại → "Không có thửa đất nào mang mã này".
7. Tắt backend (T3) rồi tra lại → thông báo không kết nối được, **không** phải trang trắng.

### 3.2 UC-5 — `/vi/resident/proof`, ownership

1. Mở trang. Banner đầu trang phải nói mọi thứ chạy trên máy người dùng.
2. Kéo thả ZIP bộ hồ sơ (hoặc chọn 2 tệp JSON).
3. Bốn ô kiểm tra tệp đều xanh; bảng thông tin giấy chứng nhận hiện ra. Bảng phải có dòng
   **Hình thức sử dụng đất** (Lâu dài / Có thời hạn) và ⚠️ **không** có ngày hết hạn ở bất kỳ dòng
   nào — D70 cố tình dừng ở đó, vì đây là màn hình hay bị người khác đứng cạnh nhìn.
4. Nếu receipt cũ hơn gốc hiện tại → banner **xanh dương** (info) nói proof trong tệp đã được làm
   mới tự động. ⚠️ Đây là trạng thái **bình thường**; nếu nó hiện màu đỏ hoặc chặn nút Generate thì
   sai (D64).
5. Chọn "Tôi là chủ sở hữu thửa đất này" → **Tạo proof** → **ghi thời gian** vào §5.
6. Panel kết quả hiện hai danh sách: đã tiết lộ (4 signal) và **không bao giờ tiết lộ**.
7. Tải `proof-ownership-<id>.json` về — giữ lại cho §3.5.

**Bước DoD — kiểm tab Network.** Làm đúng như sau:

1. DevTools → Network → bật **Preserve log** → **Clear**.
2. Tải lại trang, làm lại toàn bộ luồng trên.
3. Danh sách request phải **chỉ** gồm: `GET /api/public/config`, `GET /api/proof/<id>`, các tệp tĩnh
   `/circuits/ownership/*`, và tài nguyên của Next. Không có POST nào.
4. Mở request `/api/proof/<id>` → tab Payload/Request → **phải không có body**.
5. Trong ô filter của Network gõ `ownerSecret` → **0 kết quả**. Gõ giá trị `area` và chuỗi địa chỉ
   lấy từ `receipt.json` → **0 kết quả**.
6. Kiểm cả request do worker phát: bật lọc "All" và xem cột Initiator, worker chỉ tải `.wasm`/`.zkey`.

### 3.3 UC-5 — mortgage

1. Cùng bộ hồ sơ, chọn "Sổ sạch và còn đủ thời hạn".
2. Nhập số năm (D16 — con số ngân hàng yêu cầu, không phải thời hạn thật). Thử nhập `1.5`, `-1` và
   `5e1` → báo lỗi, nút bị khoá. Thử `71` → dòng đỏ "Tối đa 70 năm…" (D70), `70` → nhận.
3. Nhập `5` → Generate → **ghi thời gian** vào §5.
4. Panel kết quả phải liệt kê `minRequiredRemainingTerm` ở cột **đã tiết lộ**, và
   `Ngày hết hạn sử dụng đất` + `Tình trạng thế chấp` ở cột **không bao giờ tiết lộ**. Đây là điểm
   bán hàng của cả hệ thống — nếu hai thứ này lọt sang cột trái thì `mortgage.circom` vô nghĩa.
5. Tải `proof-mortgage-<id>.json` về — giữ cho §3.5.

### 3.4 UC-5 — các đường thất bại

| Thao tác | Kỳ vọng |
| --- | --- |
| Sửa `area` trong `receipt.json` rồi nạp lại | Ô "Thông tin trên giấy đúng như lúc được cấp" đỏ, thông báo nói rõ một thông tin đã bị sửa sau khi cấp (D36). **Không cho prove.** |
| Đổi `secret.json` sang thửa khác | Báo `receipt.json` và `secret.json` là của hai thửa khác nhau |
| Nạp ZIP tổng của cả đợt | "Đây là ZIP tổng của cả đợt… hãy chọn thư mục của một thửa" |
| Chỉ nạp `receipt.json` | Báo thiếu `secret.json`, **kèm gợi ý sang trang Kiểm tra proof** |
| Thửa chưa cấp giấy | "Thửa đất này chưa được cấp giấy" (không phải lỗi chung chung) |
| Thửa đã thu hồi | "Giấy chứng nhận này đã bị thu hồi" — nói rõ **không proof nào tồn tại được**. Và kiểm đủ ba thứ đi kèm: **không** còn bảng thông tin giấy, **không** còn 4 dấu ✓, **không** còn dòng "Đang kiểm tra cơ quan đăng ký và blockchain…" quay mãi. Cũng **không** có nút Thử lại — lá đã rời khỏi cây thì thử lại bao nhiêu lần cũng vậy |
| Đổi tên `public/circuits/ownership/` rồi Generate | Báo thiếu tệp tạo proof kèm tên lệnh `circuits:sync-frontend`; **không treo** |

#### 3.4.1 D68 — các ngõ cụt phải chặn **trước** khi bấm Generate

Đây là nhóm mà trước D68 chỉ vỡ bên trong prover, sau 8 giây, dưới dạng
`Assert Failed. Error in template Ownership_226 line: 76`. Điểm cần soi không phải là
"có báo lỗi không" mà là **báo ở đâu** và **còn hiện gì bên cạnh**.

| Thao tác | Kỳ vọng |
| --- | --- |
| Chuyển nhượng thửa 4 qua quầy (§3.x của `PHASE_8_MANUAL_TEST.md`), publish change set, rồi nạp lại **bộ hồ sơ cũ** của thửa 4 | Ngay sau khi đọc file: "Giấy này không còn là bản ghi hiện hành của thửa đất". **Không** hiện bảng thông tin giấy, **không** hiện 4 dấu ✓, **không** hiện banner xanh "đã được làm mới", **không** hiện mục 3 lẫn nút Generate |
| Cùng bộ hồ sơ cũ đó, nhưng change set mới **ký mà chưa confirm** | Phải ra "Cơ quan đăng ký còn thay đổi chưa đưa lên blockchain", **không** phải thông báo sổ bị thay thế — leaf lúc này thuộc cây chưa ai công bố |
| Sửa `validityPeriod` trong DB về quá khứ cho một thửa FIXED_TERM, publish lại, nạp bộ hồ sơ | "Thời hạn sử dụng đất trên giấy này đã hết", hiện **ngay** — mở DevTools → Network xác nhận **không có** request `GET /api/proof/:id` nào |
| Nạp bộ hồ sơ của một thửa PERPETUAL (ONT/ODT, `validityPeriod = 0`) | Vào thẳng mục 3 bình thường. ⚠️ Đây là ca bắt lỗi sentinel D5/D23 — nếu ra "đã hết hạn" thì bản sao TS đang so sánh ngây thơ. Bảng thông tin ghi **Hình thức sử dụng đất: Lâu dài** |
| Cùng thửa PERPETUAL đó, chọn mortgage | Ô nhập năm **vẫn hiện, vẫn bắt nhập, nhãn y hệt** thửa có thời hạn (D70 — ẩn ô hay tự điền sẽ khiến public signal tố cáo `tenureType`). Dưới ô là câu màu **xám** giải thích thửa lâu dài đạt mọi ngưỡng và vẫn nên nhập đúng con số ngân hàng yêu cầu — **không** phải dòng đỏ |
| Cùng thửa PERPETUAL, nhập `70` → Generate | Tạo được proof. Đây là ca mà so sánh ngây thơ `validityPeriod >= now + 70 năm` sẽ chặn nhầm, vì `validityPeriod = 0` |
| Đặt `encumbranceStatus = MORTGAGED` cho thửa đang dùng, publish lại, nạp bộ hồ sơ | Lựa chọn "Sổ sạch và còn đủ thời hạn" **mờ và không bấm được**, kèm lý do; lựa chọn ownership vẫn chạy bình thường |
| Chọn mortgage (thửa **có thời hạn**), nhập số năm lớn hơn thời hạn còn lại nhưng **vẫn dưới trần 70** — ví dụ thửa còn 10 năm thì nhập `60` | Dòng đỏ dưới ô nhập, nút Generate **khoá**. ⚠️ Thông báo **không được** in ra số năm thật còn lại — đó đúng là con số mortgage proof tồn tại để giấu. ⚠️ Đừng dùng `99` để thử ca này: từ D70, `99` dừng ở trần trước khi chạm tới phép so thời hạn, nên sẽ ra thông báo khác |
| Chọn mortgage, hạ số năm xuống dưới hạn | Dòng đỏ biến mất, nút Generate mở lại ngay, không cần nạp lại file |
| Bất kỳ lỗi prover nào lọt lưới | Màn hình chỉ được hiện "Không tạo được proof" + câu giải thích. Chuỗi `Assert Failed…` phải nằm trong **console**, không nằm trên trang |

### 3.5 UC-6 — `/vi/resident/verify`, cả ba loại proof

1. Dán `proof-ownership.json` từ §3.2 → **Kiểm tra proof này**.
2. Bốn ô kiểm tra chạy đúng thứ tự và đều đạt. Mỗi ô phải có một câu giải thích **vì sao** bước đó
   tồn tại — đặc biệt ô đầu (mốc thời gian do người tạo proof chọn).
3. Kết luận: **Chấp nhận, có lưu ý** (vì chưa nộp receipt).
4. Lặp lại với `proof-mortgage.json`.
5. Proof transfer — sinh bằng:
   ```bash
   SAVE_PROOF_DIR=/tmp/p9 GOV_API_KEY=... pnpm --filter blockchain run transfer:smoke <bundle-dir>
   ```
   rồi dán `/tmp/p9/transfer.verify.json`. Đọc §0b về hạn 10 phút.
   ⚠️ **Sau khi ChangeSet của giao dịch đó được publish, proof transfer phải fail `RootMismatch`** —
   đó là kết quả đúng (proof đã tiêu), và trang phải nói rõ điều đó chứ không để người đọc tưởng là
   gian lận.

### 3.6 UC-6 — bốn mắt xích D30

1. Ở kết quả §3.5, bấm **Thêm receipt.json** và chọn `receipt.json` của bộ hồ sơ.
2. Mắt xích 1 (`certificate`) phải là **dấu tích xanh** + dòng "Do Demo Government Root CA cấp" (D78).
   Điều kiện: đã chạy `cert:generate` **trước** khi build/khởi động frontend (root được ghim lúc
   build) và bundle được phát hành **sau** đó. ⚠️ Receipt phát hành với chứng chỉ tự ký cũ phải ra
   **dấu X đỏ** và kết luận **Không nên chấp nhận** — đó là kết quả đúng. Frontend build khi chưa có
   `pki/root-ca.cert.pem` phải ra **icon trung tính** + "chưa cấu hình CA gốc tin cậy", không bao giờ
   là dấu tích xanh.
3. Mắt xích 2, 3, 4 (`organization`, `signature`, `role`) đều xanh.
4. Phải thấy dòng xác nhận receipt ghi **đúng** hợp đồng mà trang đang đọc.
5. Sửa **một ký tự** trong `ethereumAccountSignature` của `receipt.json` → nạp lại → **chỉ** mắt xích
   `signature` đỏ, kết luận chuyển sang **Không nên chấp nhận**.
6. Đối chiếu với bản Node:
   ```bash
   pnpm --filter blockchain run receipt:verify <bundle-dir>/receipt.json
   ```
   Hai bên **phải kết luận giống nhau** — đó là cùng một D30, một bản chạy trong Node, một bản chạy
   trong trình duyệt.

### 3.7 UC-6 — thu hồi (D45)

1. Thu hồi thửa đất qua `PHASE_8_MANUAL_TEST.md` §3.5 và publish ChangeSet.
2. Verify lại proof cũ của chính thửa đó.
3. Kỳ vọng: ô kiểm tra thứ 3 báo `RootMismatch` **và** panel thu hồi hiện mã lý do, `detailHash`,
   `rootVersion`, thời điểm thu hồi.
4. Kết luận phải là **Không nên chấp nhận** với lý do *giấy chứng nhận đã bị thu hồi* — không phải
   "proof sai". Panel cũng phải nói phần diễn giải chi tiết nằm ngoài chain và phải hỏi cơ quan.

### 3.8 UC-6 — các đường thất bại

| Thao tác | Kỳ vọng |
| --- | --- |
| Xoá một phần tử của `publicSignals` | "Số lượng public signal không khớp circuit nào" — và câu báo phải in ra các con số 4/5/7 |
| Sửa `circuitType` thành `mortgage` trên proof ownership | "Tệp ghi tên một circuit nhưng mang số signal của circuit khác" |
| Sửa một chữ số trong `pi_a` | Ô 1 đạt, ô 2 `InvalidProof`, dừng lại ở đó |
| Dán proof của §3.2 sau 15 phút | Ô 1 `StaleTimestamp` — và ô 2 **không được chạy** (kiểm bằng cách xem ô 2 vẫn ở trạng thái chờ) |
| Tắt `hardhat node` rồi verify | Ô 1–2 vẫn chạy và vẫn báo thật; ô 3–4 "chưa kiểm được"; kết luận **Chưa kiểm đủ để kết luận** — tuyệt đối không phải dấu tích xanh |
| Đổi tên `public/circuits/ownership/` rồi verify | Ô 2 bị chặn với lý do thiếu khoá xác minh, **nhưng ô 3 và 4 vẫn chạy** — kết luận của hợp đồng vẫn lấy được |

### 3.9 Biên giới portal

1. Mở DevTools → Sources (hoặc Coverage) trên cả ba trang resident.
2. **Không được có** chunk nào của wagmi / RainbowKit / WalletConnect.
3. Trên `/resident/lookup` và trang verify **chưa nạp receipt**: không có chunk circomlibjs/snarkjs
   nào trong lần tải đầu.
4. `pnpm --filter frontend run lint` phải xanh — đó mới là thứ cưỡng chế ranh giới này.

### 3.10 D81 — hai case của 28/09/2026

1. **Case chuyển nhượng:** sau bước 3 ở `PHASE_8_MANUAL_TEST.md` §3.8 (APPROVED, chưa publish),
   người bán mở `/resident/proof` với bundle cũ → ngõ cụt "Giấy chứng nhận đang bị ngăn chặn giao
   dịch". Sinh mortgage proof bằng `pnpm --filter blockchain run proof:bodies <unzipped-bundle-dir>
   [out-dir]` (ghi ra body dán thẳng được; `owner:smoke` chỉ in ra màn hình) — hoặc proof lưu từ
   trước khi freeze, còn trong 10 phút — → dán vào `/resident/verify` → check 4 "Chủ sở hữu không
   bị ngăn chặn" **fail**, lý do `OwnerFrozen`; `POST /api/proof/verify` → 422 `OwnerFrozen`.
2. **Case thu hồi:** sau bước 4 ở §3.8 (revocation PENDING), chủ bị thu hồi → như case 1.
3. Sau khi change set confirm: người mua prove → pass cả 5 check; người bán cũ → `superseded`
   (UC-5) / `RootMismatch` (UC-6).
4. Transfer proof dán vào UC-6 → check 4 hiện "Không áp dụng".

---

## 4. Kết quả mong đợi (DoD)

| Điều kiện DoD | Mục |
| --- | --- |
| Sinh được ownership proof trong browser | 3.2 |
| Sinh được mortgage proof với ngưỡng năm tự nhập (D16) | 3.3 |
| Thửa lâu dài: ô nhập năm **không đổi hình dạng**, trần 70 năm áp cho cả hai màn (D70) | 3.3, 3.4.1 |
| Verify được cả 3 loại proof | 3.5 |
| 4 bước kiểm đúng tên và đúng thứ tự của contract (D33), freshness trước (D26) | 3.5, 3.8 |
| Chuỗi danh tính D30 đủ 4 mắt xích, mắt xích CA khai báo trung thực | 3.6 |
| Trạng thái thu hồi đọc từ `revocations` on-chain (D45) | 3.7 |
| Chỉ hiện public signal của đúng loại proof + nói rõ field nào không tiết lộ | 3.3, 3.5 |
| Tra được lịch sử thửa đất (D48) | 3.1 |
| **Tab Network không có `ownerSecret` / private field** | 3.2 |
| Không có ví / wagmi trên trang resident | 3.9 |
| D81: check thứ 5 + ngõ cụt `owner-frozen` đúng cả hai case (chuyển nhượng, thu hồi) | 3.10 |

---

## 5. Số đo cần ghi

| Đo | Giá trị |
| --- | --- |
| Ownership proof trong browser (Chrome, localhost) | *chưa đo* |
| Mortgage proof trong browser | *chưa đo* |
| Ownership proof trong Node, cùng witness (Vitest integration) | *chưa đo* |
| Mortgage proof trong Node | *chưa đo* |
| Tải `ownership.zkey` lần đầu (kích thước + thời gian) | *chưa đo* |
| Tải `mortgage.zkey` lần đầu | *chưa đo* |
| Verify off-chain trong browser (gồm fetch vkey) | *chưa đo* |
| `eth_call` verify on-chain (localhost) | *chưa đo* |
| Transfer proof trong browser (so với 2,27 s trong Node ở Phase 8) | *chưa đo* |
| Lần tải đầu của chunk `@peculiar/x509` (đo được 194 kB khi build) | *chưa đo* |

Kích thước bundle lần tải đầu, đo từ `next build` ngày 18/09/2026:

| Trang | Initial JS | wallet | crypto | x509 |
| --- | --- | --- | --- | --- |
| `/resident/lookup` | 568 kB | không | không | không |
| `/resident/proof` | 874 kB | không | không (nạp khi chọn tệp) | không |
| `/resident/verify` | 892 kB | không | không (chỉ trong worker) | không (nạp khi thêm receipt) |
| `/government/transfers` | 4481 kB | **2 chunk** | 1 | không |

---

## 6. Chưa kiểm (ghi ra thay vì để tưởng là đã xong)

- **Sepolia.** Mọi bước ở đây là localhost. `rpcUrlForChain` có nhánh Sepolia nhưng chưa thử lần
  nào, và public RPC có thể siết `eth_call` của bước kiểm thứ 4.
- **Mắt xích 1 trong trình duyệt thật.** Logic chuỗi root → issuer (D78) đã có test đối chiếu
  browser/Node bằng chứng chỉ openssl, nhưng chưa bấm tay trên trang: dấu tích xanh + tên root, dấu X
  với receipt tự ký cũ, icon trung tính khi build thiếu root.
- **Firefox / Safari.** Chỉ thử Chrome. Hai chỗ dễ lệch nhất: WebCrypto `RSASSA-PKCS1-v1_5` và cặp
  Web Worker + WASM.
- **Điện thoại thật.** Proof vài giây trên desktop có thể là hàng chục giây trên mobile, và hai tệp
  `.zkey` phải tải xong mới prove được. Chưa đo (xem R7 trong spec).
- **Proof của root lịch sử.** D29 giữ `rootHistory` nhưng D33 chỉ verify `latestRoot`. Chưa có UI
  nói riêng cho trường hợp ai đó mang proof của phiên bản cũ tới — hiện nó chỉ ra `RootMismatch`.
- **Nhiều người verify cùng lúc / proof rất lớn.** Chưa thử.
- **`openapi.json`** đã export lại sau khi thêm `/api/public/config` (25 path), nhưng chưa export
  lại trên một backend trỏ `localhost` — bản hiện tại sinh từ backend trỏ `sepolia`.
