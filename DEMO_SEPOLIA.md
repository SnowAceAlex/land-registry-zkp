# Demo đầy đủ trên Sepolia — từ deploy tới kịch bản bảo vệ

Runbook dựng lại toàn bộ hệ thống trên Sepolia sau D82 (xác nhận tình trạng thay sổ ngăn chặn D79–D81), rồi chạy một kịch bản demo
đi qua cả 6 use case, gồm hai case tấn công cửa sổ chờ đợt vào sổ phải bị từ chối.

Mọi lệnh chạy từ **gốc repo** trong **Git Bash**. Dòng nào đặt biến môi trường kiểu `A=1 lệnh` thì
PowerShell viết `$env:A='1'; lệnh`.

| Mục | Nội dung | Thời gian |
|---|---|---|
| 1 | Một ví cho cả demo | 5 phút |
| 2 | Điền 3 file `.env` | 10 phút |
| 3 | Artifact mật mã + test | 5 phút |
| 4 | Chứng thư X.509 | 1 phút |
| 5 | Deploy Sepolia | 5–10 phút |
| 6 | Database sạch | 2 phút |
| 7 | Khởi động + Metamask | 5 phút |
| 8 | Kịch bản demo | 30–40 phút |

Ước tính Sepolia ETH: deploy 5 contract + vài giao dịch demo (registerAuthority, grantRole, publish) — từ D82 không còn giao dịch nào theo từng hồ sơ
⇒ chuẩn bị **≥ 0,1 Sepolia ETH** cho chắc (con số thật tuỳ gas price lúc chạy).

---

## 1. Một ví cho cả demo

Dùng **một** tài khoản cho bốn vai: deployer, authority được `registerAuthority`, ví Metamask của cán
bộ, và khoá backend (`AUTHORITY_PRIVATE_KEY`).

Lý do: backend ký địa chỉ `AUTHORITY_PRIVATE_KEY` bằng khoá X.509 của cơ quan và ghi vào
`receipt.issuer.ethereumAccountSignature` (D30). Trang verify đối chiếu địa chỉ đó với
`authorityInstitute` + `STATE_AUTHORITY_ROLE` on-chain. Còn Metamask phải có role thì mới ký được
`publishRoot`. Một ví thì cả chuỗi khớp, không phải cấp role thêm.

Riêng **khoá attester** (D82) là tài khoản **thứ hai**: nó chỉ ký xác nhận tình trạng off-chain, không
gửi giao dịch nên **không cần ETH**, và tách khỏi ví authority để lộ khoá này không publish được root.
Tạo thêm một tài khoản bất kỳ, ghi lại địa chỉ + private key.

- Tạo một tài khoản Metamask mới chỉ dùng cho testnet, export private key.
- Xin Sepolia ETH (faucet ở `DEPLOYMENT.md` §2.2).

---

## 2. Điền `.env`

Có **ba** file, mỗi nơi đọc file của nó:

### 2.1 `.env` ở gốc repo — Hardhat, `cert:generate`, `transfer:smoke`, Prisma

```bash
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<KEY>
PRIVATE_KEY=0x<khoá ví demo>
AUTHORITY_ADDRESS=                     # để trống = chính deployer
AUTHORITY_PRIVATE_KEY=0x<khoá ví demo> # cùng khoá; để khoá Hardhat #0 ở đây thì transfer:smoke hỏng
AUTHORITY_ORG_NAME="So Tai nguyen va Moi truong TP.HCM"
ATTESTER_ADDRESS=0x<địa chỉ khoá attester> # bắt buộc trên Sepolia — deploy cấp ATTESTER_ROLE cho nó (D82)
ETHERSCAN_API_KEY=<tuỳ chọn, cho bước verify source>
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/land_registry?schema=public"
CHAIN_NETWORK=sepolia
GOV_API_KEY=<chuỗi bí mật tự đặt>
```

`AUTHORITY_ORG_NAME` là Subject `O` của chứng thư **và** giá trị neo on-chain — chốt trước khi deploy.

### 2.2 `web-app/backend/.env` — backend

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/land_registry?schema=public"
CHAIN_NETWORK=sepolia
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<KEY>
AUTHORITY_PRIVATE_KEY=0x<khoá ví demo>
ATTESTER_PRIVATE_KEY=0x<khoá attester> # khớp ATTESTER_ADDRESS; thiếu là backend không khởi động (D82)
GOV_API_KEY=<giống gốc>
REVOCATION_CAP=989 # tối đa thu hồi mỗi vòng (D91; xem dưới)
FRONTEND_URL=http://localhost:3000
```

⚠️ **`REVOCATION_CAP=989` trên Sepolia** (D91: sổ thu hồi dạng bitmap, trần đợt tệ nhất 1.039 thửa/tx,
chừa 50). Sau mỗi lần deploy hoặc hard fork, `CAP=989 pnpm --filter blockchain run
chain:revocation-ceiling:sepolia` phải in `PASS`. `GOV_API_KEY` là khoá của trụ sở (`HQ`, phạm vi trung
ương); chi nhánh dùng khoá riêng in ra khi `seed:land-offices`.

⚠️ **Xoá dòng `RPC_URL=http://127.0.0.1:8545`** nếu còn: `RPC_URL` thắng mọi cấu hình khác, backend sẽ
âm thầm đọc node local thay vì Sepolia.

### 2.3 `web-app/frontend/.env` — frontend

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_SEPOLIA_RPC_URL=<RPC cho trình duyệt — để trống thì dùng publicnode>
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<từ cloud.walletconnect.com>
```

- Biến `NEXT_PUBLIC_*` nằm trong bundle trình duyệt: đừng dùng key Alchemy chính ở đây, tạo key riêng
  hoặc để trống.
- File này hiện còn `PRIVATE_KEY`, `DATABASE_URL`, `SEPOLIA_RPC_URL` — frontend không dùng tới, nên
  **xoá đi** cho sạch.
- Địa chỉ contract **không** đặt ở đây: portal lấy từ backend (D54/D58). `NEXT_PUBLIC_CONTRACT_ADDRESS`
  bỏ qua được.

---

## 3. Artifact mật mã + test

⚠️ **Không chạy `circuits:setup`** nếu `blockchain/circuits/build/` đã có: nó sinh `.zkey` mới, mọi
proof cũ và bộ verifier sắp deploy sẽ lệch nhau (`DEPLOYMENT.md` §3). Chỉ chạy khi thư mục đó trống.

```bash
pnpm install
pnpm --filter blockchain run verifiers:sync      # verifier .sol lấy từ đúng .zkey hiện tại
pnpm run compile
pnpm run test:blockchain                         # kỳ vọng 183 passing (test tích hợp proof thật phải chạy, không skip)
pnpm --filter blockchain run circuits:sync-frontend   # wasm/zkey/vkey cho trình duyệt — 9 dòng "synced"
```

---

## 4. Chứng thư X.509 (D30 + D78)

```bash
pnpm --filter backend run cert:generate
openssl x509 -in web-app/backend/certs/issuer.cert.pem -noout -subject -issuer
```

- Lần đầu: tạo Demo Root CA (`pki/root-ca.*`) + chứng thư cơ quan (`web-app/backend/certs/issuer.*`).
- Đã có sẵn: lệnh giữ nguyên. Subject phải có `O = <đúng AUTHORITY_ORG_NAME>`, issuer là
  `Demo Government Root CA`.
- Đổi `AUTHORITY_ORG_NAME` → `FORCE=1 pnpm --filter backend run cert:generate` (cấp lại chứng thư cơ
  quan, giữ root).
- **Không cần bước "ký" riêng:** chữ ký X.509 trên địa chỉ Ethereum do backend tự tạo cho mỗi bundle,
  từ `certs/issuer.key.pem` + `AUTHORITY_PRIVATE_KEY`.
- Root CA được ghim vào frontend lúc build/khởi động: đổi root (`FORCE_ROOT=1`) thì phải khởi động lại
  frontend.

---

## 5. Deploy Sepolia

```bash
pnpm --filter blockchain run deploy:sepolia
```

Kỳ vọng:
- Dòng đầu in `balance:` của deployer, `org name` + hash.
- 5 địa chỉ, rồi `STATE_AUTHORITY_ROLE + authorityInstitute anchored for 0x…` (chính ví demo).
- `deployment record → deployments/sepolia.json`, cuối cùng là các lệnh `npx hardhat verify …`.

Kiểm tra (chỉ đọc, không tốn gas):

```bash
pnpm --filter blockchain run chain:smoke:sepolia
```

Đừng chạy `SMOKE_PUBLISH=1` cho bản demo: nó publish một root từ dữ liệu mock, lệch với DB — gốc v1
nên là đợt cấp giấy đầu tiên.

Tuỳ chọn — verify source trên Etherscan (chạy trong `blockchain/`, copy đúng các lệnh deploy in ra):

```bash
cd blockchain
npx hardhat verify --network sepolia <ROOT_REGISTRY> <DEPLOYER>
npx hardhat verify --network sepolia <VERIFIER_OWNERSHIP>
npx hardhat verify --network sepolia <VERIFIER_MORTGAGE>
npx hardhat verify --network sepolia <VERIFIER_TRANSFER>
npx hardhat verify --network sepolia <LAND_REGISTRY_VERIFIER> <ROOT_REGISTRY> <V_OWNERSHIP> <V_MORTGAGE> <V_TRANSFER>
cd ..
```

Lưu vết + backup:

```bash
git add blockchain/deployments/sepolia.json      # file này được track — commit khi bạn sẵn sàng
mkdir -p /d/backup && cp -r blockchain/circuits/build /d/backup/land-registry-circuits-build   # bộ .zkey duy nhất khớp verifier vừa deploy
```

---

## 6. Database sạch

Contract mới ⇒ mọi commitment/leaf/receipt cũ vô nghĩa. Reset toàn bộ:

```bash
pnpm run db:up
pnpm --filter backend prisma migrate reset --force
pnpm --filter backend run db:generate
pnpm --filter backend run seed:admin-units DVHC_TPHCM.csv --province "TP.HCM"
pnpm --filter backend run seed:land-offices
```

`seed:land-offices` tạo các chi nhánh `CN01`…`CN38` và **in khoá API của từng chi nhánh một lần duy nhất**
— lưu lại ngay (mất thì `pnpm --filter backend run office:rotate-key <MÃ>` cấp khoá mới). `HQ`, `CS2`,
`CS3` đã có sẵn từ migration. Chạy sau `seed:admin-units` vì nó đối chiếu danh mục phường/xã.

`seed:admin-units` chạy với thư mục `web-app/backend/`, nên đường dẫn `DVHC_TPHCM.csv` là tương đối
tới đó.

---

## 7. Khởi động + Metamask

```bash
pnpm run dev:backend      # terminal 1
pnpm run dev:frontend     # terminal 2 → http://localhost:3000
```

Backend đúng khi log có `connected to sepolia (…) as 0x<ví demo>; RootRegistry=0x<địa chỉ mới>` và
**không** có cảnh báo thiếu `STATE_AUTHORITY_ROLE`. Mỗi lần đọc chain trên Sepolia mất 1–3 s (D74),
chậm hơn localhost là bình thường.

Metamask: bật mạng **Sepolia** (có sẵn, bật "Show test networks") và import private key ví demo.

Tuỳ chọn cho buổi bảo vệ (trang mở nhanh hơn dev server):

```bash
pnpm --filter frontend run build && pnpm --filter frontend run start
```

---

## 8. Kịch bản demo

Dữ liệu: `blockchain/fixtures/demoImport.csv` (10 thửa, mã 201–210). Vai trò các thửa dùng trong demo:

| Thửa | Đặc điểm | Dùng cho |
|---|---|---|
| 201 | ODT, lâu dài, FREE | chuyển nhượng + **case tấn công 1** |
| 203 | LUC, có thời hạn tới 2074, FREE | thu hồi + **case tấn công 2** |
| 206 | TMD, thuê dự án tới 2071, FREE | proof thế chấp hợp lệ (happy path) |
| 202 | ONT, đang thế chấp | mortgage proof bị từ chối từ gốc (D7) |
| 209 | HNK, cộng đồng dân cư (CDS) | không được chuyển nhượng (Điều 39) |

Gợi ý: giữ một terminal Git Bash có sẵn biến cho các lệnh CLI:

```bash
export CHAIN_NETWORK=sepolia SEPOLIA_RPC_URL=<RPC> GOV_API_KEY=<key>
```

### 8.1 Đăng nhập + nhập dữ liệu (UC-2)

1. `http://localhost:3000/vi/government` → nhập `GOV_API_KEY` (đăng nhập với tư cách trụ sở `HQ`).
2. Thanh trạng thái: `sepolia · Chuỗi 11155111`, "Chưa công bố gốc nào"; ngay dưới có "Đơn vị: …Trụ sở chính".
3. Trang Nhập dữ liệu → chọn `demoImport.csv` → dry-run liệt kê dòng hợp lệ / lỗi, **chưa ghi gì**
   (D52) → **Nhập 10 dòng hợp lệ**. Các thửa ở bảng trên phải có mặt.

### 8.2 Cấp giấy (UC-1, D43)

1. Trang Cấp giấy (chỉ trụ sở) → chọn cả 10 thửa → **Đề nghị cấp** — mỗi thửa thành một
   đề nghị trong hàng chờ chung (D87); chưa ký gì.
2. Trang **Chốt sổ** → **Tạo đợt vào sổ** → **Kết nối ví** (Metamask) → **Ký và công bố đợt vào sổ** → xác nhận
   `publishRoot` → chờ block (~12 s) → tự confirm → "Đợt vào sổ #1 đã công bố (v1)". Một đợt vào sổ gom cả
   cấp giấy, chuyển nhượng và thu hồi dưới một gốc (D84).
3. Trang **Hồ sơ các đợt vào sổ** → **Tải ZIP** ở từng dòng chi nhánh (mỗi chi nhánh một ZIP, chi nhánh chỉ tải được ZIP của mình,
   D88; trụ sở tải được tất cả) → giải nén hết vào cùng `demo/batch-1/` (mỗi thửa một thư mục
   `201/`, `202/`, …).
4. Kiểm một bundle bằng CLI (chuỗi D30 + root on-chain):

   ```bash
   pnpm --filter blockchain run receipt:verify demo/batch-1/206/receipt.json
   ```

### 8.3 Người dân — happy path (UC-5 → UC-6)

1. Tab ẩn danh: `http://localhost:3000/vi/resident/proof` → thả thư mục `206/` → chọn **Thế chấp**,
   ngưỡng 20 năm → tạo proof (chạy trong trình duyệt, secret không rời máy) → tải `proof.json`.
2. `/vi/resident/verify` → dán proof → **5 check** xanh: tươi, mật mã, khớp root, **chủ không bị ngăn
   chặn**, contract on-chain. Nạp thêm `206/receipt.json` → chuỗi cơ quan phát hành: root CA → chứng
   thư → chữ ký địa chỉ → anchor on-chain đều đạt ⇒ phán quyết **Hợp lệ**.
3. (Tuỳ chọn) thửa 202 đang thế chấp: UC-5 không cho tạo mortgage proof — đúng D7/D68.

### 8.4 Chuyển nhượng tại quầy + **case tấn công 1** (UC-3, D82)

1. Trang Chuyển nhượng → nạp hồ sơ bên bán `201/` → kiểm tra hồ sơ xanh. **Không** có bước ký ví nào.
2. Bước 2: **Tạo bằng chứng và nộp hồ sơ** → hàng chờ "Chờ duyệt" → **Phê duyệt** (trong vòng 10 phút kể từ khi tạo
   proof) → trạng thái APPROVED, chờ đợt vào sổ. Từ lúc nộp, hồ sơ mở chính là khoá.
3. **Tấn công — bên bán đem sổ đi vay trong lúc chờ đợt vào sổ:**
   - UC-5 với `201/` → dừng ở "Giấy chứng nhận đang có thủ tục chưa hoàn tất" (ngõ cụt `procedure-open`).
   - Sinh proof bằng CLI (không qua UI):

     ```bash
     pnpm --filter blockchain run proof:bodies demo/batch-1/201 demo/attack-201
     # → "attestation REFUSED — the plot has an open procedure; bodies carry none (D82)"
     ```

     dán `demo/attack-201/mortgage.verify.json` vào `/vi/resident/verify` → check 4 **Cơ quan đăng ký
     xác nhận không có thủ tục đang mở** đỏ, lý do `InvalidAttestation`, phán quyết **Từ chối**.
   - Contract cũng từ chối (dán body trong 10 phút):

     ```bash
     curl -s -X POST http://localhost:3001/api/proof/verify -H "Content-Type: application/json" \
       --data "$(jq '.onChain=true' demo/attack-201/mortgage.verify.json)"
     # → 422 {"reason":"InvalidAttestation", …}
     ```

     (Không có `jq` thì sửa tay `"onChain": false` thành `true` trong file rồi `--data @file`.)
4. (Tuỳ chọn) thửa 209 (CDS) → quầy từ chối chuyển nhượng theo Điều 39.

### 8.5 Thu hồi + **case tấn công 2** (UC-4, D45/D82)

1. Trang Thu hồi → thửa `203`, lý do "Nhà nước thu hồi đất", "Căn cứ quyết định" tuỳ ý → **Đưa vào hàng chờ** → đề nghị
   vào hàng chờ ngay, không ký gì.
2. **Tấn công — chủ bị thu hồi đem sổ đi vay:** lặp lại 8.4.3 với `203/`
   (`proof:bodies demo/batch-1/203 demo/attack-203`) → UC-5 ngõ cụt, UC-6 `InvalidAttestation`.

### 8.6 Chốt sổ (UC-4, D46, D84)

1. Trang **Chốt sổ** → hàng chờ có 1 chuyển nhượng + 1 thu hồi →
   **Tạo đợt vào sổ** → **Ký và công bố đợt vào sổ** (`publishRootWithRevocations`) → confirm → "Đợt vào sổ #2 đã công bố (v2)".
2. Trang **Hồ sơ các đợt vào sổ** → tải ZIP của đợt #2 theo chi nhánh → giải nén vào `demo/changeset-1/` → có `201/` của **bên mua**
   (receipt + secret mới, D77).
3. Sau publish:
   - Bên mua: UC-5 với `demo/changeset-1/201/` → tạo proof → UC-6 xanh cả 5 check.
   - Bên bán cũ: UC-5 với `demo/batch-1/201/` → "Giấy chứng nhận không còn hiệu lực" (lá đã đổi).
   - Chủ thửa 203: UC-5 → "đã bị thu hồi" (410, lá bị gỡ); lý do thu hồi (mã on-chain) xem ở `/vi/resident/lookup`.
   - `/vi/resident/lookup` → tra `201` và `203` → lịch sử có sự kiện chuyển nhượng / thu hồi gắn
     `rootVersion` + tx hash.

### 8.7 Từ chối hồ sơ là mở khoá (tuỳ chọn, D82)

1. Nạp hồ sơ thửa `206/` ở quầy → nộp → UC-5 với `206/` báo ngõ cụt `procedure-open`.
2. **Từ chối** ở hàng chờ → chủ 206 tạo proof lại được ngay, không cần ký giao dịch nào.

---

## 9. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| Backend đọc `127.0.0.1:8545` dù đã đặt sepolia | Còn `RPC_URL` trong `web-app/backend/.env` | Xoá dòng đó |
| Portal: "không có quyền STATE_AUTHORITY_ROLE" | Metamask đang ở tài khoản khác ví demo | Đổi tài khoản trong Metamask |
| Backend log cảnh báo thiếu role | `AUTHORITY_PRIVATE_KEY` backend ≠ ví đã `registerAuthority` | Đặt đúng khoá, khởi động lại backend |
| UC-6: chuỗi cơ quan "không xác minh được" link 1 | Frontend khởi động trước `cert:generate`, hoặc root đổi sau khi khởi động | Khởi động lại frontend |
| UC-6: organization không khớp | `AUTHORITY_ORG_NAME` lúc deploy ≠ `O=` trong chứng thư | Thống nhất tên → `FORCE=1 cert:generate` hoặc deploy lại |
| Duyệt chuyển nhượng báo `StaleTimestamp` | Proof quá 10 phút | Từ chối hồ sơ, làm lại bước 2 ở quầy |
| Mọi proof ownership/mortgage bị `InvalidAttestation` | `ATTESTER_PRIVATE_KEY` backend không phải tài khoản được cấp `ATTESTER_ROLE` (backend log lỗi lúc khởi động) | Đặt đúng khoá khớp `ATTESTER_ADDRESS`, hoặc deploy lại |
| `receipt:verify` đọc localhost | Chưa `export CHAIN_NETWORK=sepolia SEPOLIA_RPC_URL=…` | Xem đầu mục 8 |
| Mọi check chain "không khả dụng" ở trang resident | RPC công khai quá tải / bị chặn | Đặt `NEXT_PUBLIC_SEPOLIA_RPC_URL` rồi khởi động lại frontend |
| `insufficient funds` | Ví demo hết Sepolia ETH | Faucet |
| On-chain `InvalidProof` nhưng off-chain đúng | `.zkey` khác bộ verifier đã deploy | Không chạy `circuits:setup` sau deploy; khôi phục `circuits/build` từ backup |
