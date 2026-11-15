# Đo hệ thống trên code cuối ở quy mô 4,5 triệu GCN: một tháng trên Hardhat, 5 ngày thật trên Sepolia sau Glamsterdam

**Ngày đo:** 12/11/2026 (bổ sung gas deploy Sepolia và tỉ giá VND ngày 13/11; đo bổ sung A1–A6 ngày 15/11, §14)
**Phiên bản hệ thống:** commit `2b23bf0` (nhánh `bench/thesis-evidence`, tách từ `dev`, cây code giống `main`): đợt vào sổ hợp nhất (D84), 41 đơn vị (D85–D86), hàng chờ chung (D87), archive theo chi nhánh (D88), lineage (D90), **sổ thu hồi bitmap (D91)**. Chỉ harness [`bench-replay-month.ts`](../../web-app/backend/scripts/bench-replay-month.ts) được sửa (§2.3); code sản phẩm không đổi
**Máy đo:** AMD Ryzen 7 6800HS (16 luồng), 15 GB RAM, Windows 11 Pro 10.0.26200, Node v22.15.0, PostgreSQL 16 (Docker `postgres:16-alpine`, cấu hình mặc định). Giống các lần 29/09 và 06/10
**Công cụ:** circom 2.2.3, snarkjs 0.7.6, circomlib 2.0.5, Hardhat 2.28.6 (solc 0.8.36, evm cancun), OpenZeppelin 5.6.1, NestJS 10.4.22, Prisma 7.0.0, Next.js 16.2.9, React 19.2.4, wagmi 2.19.5, viem 2.53.1
**Mạng:** Hardhat node cục bộ (chainId 31337, luật gas trước Glamsterdam) và Sepolia (chainId 11155111, đã lên Glamsterdam, RPC Alchemy gói free, contract bench riêng `0xC7848D47…91aa`)
**Dữ liệu thô:** [`data/`](data/), bảng tra cứu ở §12. Script chạy: [`scripts/`](scripts/)
**Bản HTML:** [`Bao-Cao-Hieu-Nang-Va-Gas-Code-Cuoi-HCMC-Sepolia.html`](Bao-Cao-Hieu-Nang-Va-Gas-Code-Cuoi-HCMC-Sepolia.html)
**Việc còn phải làm tay:** [`VIEC-THU-CONG.md`](VIEC-THU-CONG.md) (bản HTML: [`Huong-Dan-Viec-Thu-Cong.html`](Huong-Dan-Viec-Thu-Cong.html))
**Đối chiếu với:** báo cáo 06/10/2026 (`docs/bench/2026-10-06-hcmc-4.5M-attestation-report.md`, chỉ có ở máy local vì `docs/` bị gitignore). Cùng máy, cùng quy mô; workload khác ở chỗ lần này **mọi** thu hồi được vào sổ và có thêm giấy cấp lại (§2.1)

---

## 1. Tóm tắt

| Câu hỏi | 06/10 (struct thu hồi, cap 150) | **12/11 (bitmap D91, code cuối)** |
| --- | --- | --- |
| Thu hồi được vào sổ trong tháng (yêu cầu 20.890) | 3.300 | **20.890** |
| Hàng chờ thu hồi cuối tháng | 17.590 | **0** |
| Giấy cấp lại trong tháng (cấp mới thay sổ bị thu hồi) | không mô hình | **19.941** |
| Gas một thu hồi, luật trước fork (Hardhat) | 92.202 | **~25.970** (−72%) |
| Gas một thu hồi, luật sau fork (Sepolia) | 447.950 (`estimateGas`) | **~114.000** (đo thật, −75%) |
| Gas một tháng trên Hardhat (22 ngày) | 306,8 triệu | **545,4 triệu** (gấp 6,3 lần số thu hồi) |
| Đợt mỗi ngày (chữ ký ví cán bộ) | 1 | **2 trên Hardhat** (cap 591) / **1 trên Sepolia** (cap 989) |
| Một ngày đầy đủ, Hardhat / Sepolia | 372 s / 393 s | **538 s / 535 s** (p50) |
| `confirm` mỗi ngày | 345 s (2.994 bundle) | **485 s** (~3.944 bundle: thêm 950 giấy cấp lại) |
| RAM backend cao nhất | 3,14 GiB | **4,20 GiB** (một lần vọt; trung bình 1,9 GB) |
| Chi phí Sepolia một ngày | 0,0148 ETH (trước fork, 150 thu hồi) | **0,067 ETH đo thật** (tip 0,001–1 gwei); **0,108 ETH** nếu tip 1 gwei |
| Ước tính mainnet một tháng, giá gas ngày đo | 0,194 ETH ở 0,633 gwei | **0,027 ETH ≈ 56 USD ≈ 1,4 triệu đồng** ở 0,0499 gwei (luật hiện tại của mainnet) |
| Cấp Merkle proof, c ≥ 4 | ~190–208 req/s | **~200–216 req/s** (p50 10 ms ở c=1) |
| Cấp xác nhận tình trạng, c ≥ 4 | ~182–233 req/s | **~189–237 req/s** |
| Prove p50 trong Node (ownership / mortgage / transfer) | 662 / 646 / 1.074 ms | 783 / 680 / 1.143 ms (circuit không đổi, §3) |

Phát hiện chính, xếp theo tầm quan trọng:

1. **Sổ thu hồi bitmap (D91) đưa được toàn bộ 950 thu hồi mỗi ngày vào sổ.** Hàng chờ cuối tháng từ 17.590 về 0. Gas mỗi thu hồi giảm 72% theo luật cũ và 75% theo luật Glamsterdam, nên gas cả tháng chỉ tăng 1,78 lần trong khi số thu hồi được vào sổ tăng 6,3 lần.
2. **Theo luật gas hiện tại của mainnet (Hardhat), mỗi ngày cần hai đợt.** Cap 591 nhỏ hơn 950 thu hồi/ngày, nên harness tạo đợt nối tiếp (591 + 359). Mỗi đợt là một chữ ký ví của cán bộ. Trên Sepolia (cap 989) một đợt là đủ.
3. **Trên Sepolia, một đợt 950 thu hồi tốn ~108,46 triệu gas, chiếm ~54% block 200 triệu, và chạy thật được.** Ngày 06/10 đợt 150 thu hồi đã không gửi được sau fork (vượt block 60 triệu).
4. **`confirm` vẫn là nút cổ chai.** 485 s mỗi ngày, trong đó dựng bundle (gần như toàn bộ là PDF) chiếm ~93% thời gian mỗi thửa. Thêm 950 giấy cấp lại mỗi ngày làm `confirm` dài thêm ~110 s so với ngày chỉ có chuyển nhượng.
5. **Tạo nháp đợt chậm lên ~4,7 lần** (3,7 s → 17,4 s cho một đợt trên Sepolia), trong khi số lá đổi chỉ tăng 1,56 lần. Chưa tách được nguyên nhân (§9, mục 4).
6. **Phí trên Sepolia gần như toàn bộ là tip** (base fee ~35 wei). Ví giả lập để ethers tự chọn tip, nên phí thật dao động 1.000 lần giữa các ngày (0,0001–0,108 ETH).

---

## 2. Giả định và cách đo

### 2.1 Giả định phải đọc trước mọi bảng số

1. **4,5 triệu GCN = 4,5 triệu lá**, id rải đều (`propertyId = 3i + 1`). Đây là ước tính số giấy chứng nhận của TP.HCM từ báo chí, không phải số thửa.
2. **Mỗi ngày làm việc:** 2.994 chuyển nhượng + 950 thu hồi (22 ngày: 65.868 + 20.890). Thu hồi được trải đều trong tháng, nên vài ngày có 949.
3. **Mỗi giấy bị thu hồi được cấp lại ngày hôm sau** ở id kế bên (id + 1), kèm liên kết lineage (quy tắc "cấp lại = thu hồi + cấp mới với `propertyId` mới", D83/D90). Ngày 1 chưa có giấy cấp lại.
4. **Không có giao dịch nào cho từng hồ sơ** (D82). Một ngày on-chain chỉ có các giao dịch publish của đợt vào sổ.
5. **Proof chuyển nhượng không được sinh trong lúc replay**, giống các lần trước. Chi phí phía client đo riêng ở §3.
6. **Seed không gán chi nhánh**, nên mỗi đợt chỉ ra một archive (HQ). Chi phí archive theo 38 chi nhánh (D88) chưa đo (§11).
7. **Bench nén 22 ngày vào 3 giờ**, nên chưa archive nào quá hạn 7 ngày; đường xoá archive hết hạn không được chạy tới.

### 2.2 Quy trình

```
 ① bench:seed          4.500.000 GCN → DB land_registry_bench_final (bản gốc, không bao giờ bị sửa)
                       máy tắt giữa lúc dựng cây → tree:bootstrap dựng lại cây trên cùng các dòng
        ▼
 ② run-bench-hardhat   nhân bản _hh (createdb -T) → Hardhat node mới → deploy → publish genesis
        ▼
 ③ bench:month         22 ngày; mỗi ngày: xếp hàng → [POST /changesets → sign:root → confirm] lặp lại
                       khi còn thu hồi bị hoãn vì cap (tối đa 10 đợt/ngày)
        ▼
 ④ bench:confirm-breakdown (200 thửa) → bench:proof-load (200, 304, attestation; c = 1/4/16/50)
        ▼
 ⑤ run-bench-sepolia   nhân bản _sepolia → deploy contract bench lên Sepolia → genesis → ③ 5 ngày → ④ tải
                       → trả lại blockchain/deployments/sepolia.json bản gốc
```

Toàn bộ chạy **tuần tự** bằng [`scripts/run-all.sh`](scripts/run-all.sh). Không phép đo nào chạy song song phép đo khác. Backend chạy bằng `nest start` (không `--watch`), RAM của backend được lấy mẫu mỗi 2 s theo PID.

### 2.3 Thay đổi ở harness (không đổi code sản phẩm)

| Thay đổi trong `bench-replay-month.ts` | Vì sao |
| --- | --- |
| **G1: đợt nối tiếp trong ngày.** Còn `deferredRevocations > 0` thì tạo, ký và confirm đợt tiếp (tối đa 10 đợt/ngày) | Trên Hardhat cap 591 < 950 thu hồi/ngày. Không có vòng này thì 359 thu hồi/ngày bị hoãn và hàng chờ dâng dần, không đúng với phiên chốt sổ thật |
| **G2: giấy cấp lại.** Mỗi thửa bị thu hồi có một thửa IMPORTED ở id + 1 kèm dòng `property_lineage`; hôm sau tạo issuance request cho chúng (`POST /government/issuance-requests`, tối đa 500 mỗi lần gọi) | Harness cũ xoá mọi issuance request, nên mỗi ngày thiếu ~950 giấy mới |
| Chọn thửa bằng SQL: mỗi thửa thứ `step` theo `row_number()`, bỏ các thửa kế nhiệm | Các thửa đổi trải đều trên toàn dải id |
| `month.json` có thêm `issuances`, `rounds`, `txHashes` | Gas từng đợt đọc lại được từ receipt |

Lưu ý: trường `publishes` trong `month.json` vẫn đếm **ngày**, không đếm đợt (Hardhat ghi 22, thực tế 44 đợt).

### 2.4 Sự cố trong lúc đo và cách loại trừ

- **Máy tắt giữa lúc seed dựng cây** (bash báo `fork ... 0xC000026B`, log ở `data/phase3-hardhat/seed-run-interrupted.log`). Lúc đó các dòng đã nạp đủ (4.500.000 `ISSUED`, 962,1 s), nên chỉ cây được dựng lại bằng `tree:bootstrap` trên cùng dữ liệu. Cây cho ra 15.750.005 node, đúng bằng số node của 29/09 và 06/10.
- **`tree:bootstrap` in kết quả xong nhưng không tự thoát:** ChainService cứ thử nối RPC khi không có node chain. Phải dừng tiến trình bằng tay. Đây là lỗi nhỏ của script (§9).
- **Lần chạy đầu của giai đoạn Hardhat đọc root genesis ra chuỗi rỗng** (node trên Windows không mở được đường dẫn `/d/...`). Script đã dừng ở bước ký genesis trên Hardhat, trước khi chạm tới Sepolia. Sửa bằng cách đọc root bằng `sed`, rồi chạy lại từ một bản nhân bản sạch.
- **URL RPC Sepolia (có API key) bị in vào `data/phase3-sepolia/backend.log`.** Đã thay bằng `<SEPOLIA_RPC_URL>`. Mọi file trong `data/` đã được quét lại với các giá trị bí mật trong `.env`: không còn lần xuất hiện nào.

---

## 3. Kiểm tự động và chi phí circuit

| Mục | Kết quả |
| --- | --- |
| Test blockchain (Hardhat/Mocha) | **184 passing**, 0 pending, 27 s |
| Test backend (Jest) | **505 passed**, 49 suite |
| Test frontend (Vitest) | **401 passed**, 43 file, không test nào tự bỏ qua |
| `nest build`, `next build`, lint frontend | sạch |
| Lint gốc (blockchain + backend) | 1 lỗi ở dòng harness vừa sửa; đã sửa, lint lại sạch |
| Constraint ownership = mortgage | 6.741 non-linear + 7.529 linear = **14.270**, ptau 2^14 |
| Constraint transfer | 13.221 + 15.050 = **28.271**, ptau 2^15 |
| Private input | 54 / 54 / 103 |

Prove và verify trong Node, depth 24, 10 vòng:

| Circuit | prove p50 | prove p95 | verify | proof |
| --- | --- | --- | --- | --- |
| `ownership` | 783 ms | 1.265 ms | 16 ms | 724 B |
| `mortgage` | 680 ms | 837 ms | 15 ms | 723 B |
| `transfer` | 1.143 ms | 1.227 ms | 13 ms | 722 B |

Circuit không đổi từ 06/10, nhưng prove p50 cao hơn 5–18%. Lượt đo này chạy ngay sau khi máy build frontend và compile circuit, nên nhiều khả năng đây là dao động của máy. Đây vẫn là **biên dưới**: trong browser chậm hơn, và chưa đo (§11).

Artifact cho browser: zkey ownership 6.231.836 B, mortgage 6.231.879 B, transfer 12.340.895 B; wasm ~3,2 MB mỗi circuit.

---

## 4. Quy mô dữ liệu

| Hạng mục | 06/10 | **12/11** |
| --- | --- | --- |
| Node trong cây sau seed | 15.750.005 | **15.750.005** |
| Nạp dòng | 970 s | **962,1 s** |
| Dựng cây (`tree:bootstrap`) | 2.110 s | **2.112,5 s** |
| Tổng DB sau seed | 3.765 MB | **3.793 MB** (bảng Phase 10) |
| Tổng DB sau một tháng | 6.359 MB | **7.178 MB** |
| Archive sau một tháng | 2.481 MB (`change_sets`) | **3.210 MB** (`change_set_archives`, 44 đợt) |
| `merkle_nodes` / `properties` sau tháng | — | 2.146 MB / 1.734 MB |
| `property_events` / `transfer_requests` / `property_lineage` | — | 41 MB / 23 MB / 3,2 MB |

Archive tăng ~146 MB mỗi ngày làm việc. Với TTL 7 ngày, chạy thật sẽ giữ khoảng 1 GB archive cùng lúc.

---

## 5. Một ngày làm việc

### 5.1 Thời gian (giây; trung vị, kèm min–max)

| Giai đoạn mỗi ngày | Hardhat 12/11 (2 đợt) | Sepolia 12/11 (1 đợt) | Hardhat 06/10 (1 đợt) | Sepolia 06/10 |
| --- | --- | --- | --- | --- |
| Xếp hàng (2.994 chuyển nhượng + 950 thu hồi + 950 đề nghị cấp) | 20,4 (14,3–29,0) | 20,0 (14,2–22,7) | 16,4 | 13,2 |
| Tạo nháp đợt | 17,3 (10,8–21,6) | 17,4 (16,9–20,9) | 3,6 | 3,7 |
| Ký + chờ block | 12,0 (10,0–17,3) | 23,8 (17,3–41,7) | 5,4 | 25,8 |
| **`confirm`** | **484,8** (372,2–499,3) | **475,8** (361,9–483,8) | 345 | 349 |
| **Cả ngày** | **537,6** (408,5–552,1) | **535,4** (436,1–546,9) | 372 | 393 |

Cách đọc:

- Trên Hardhat số của một ngày là **tổng hai đợt**. Hai đợt Hardhat cộng lại tốn đúng bằng một đợt Sepolia ở bước tạo nháp và `confirm`. Thời gian vì vậy theo số hồ sơ trong ngày, không theo số đợt.
- **Ngày 1 không có giấy cấp lại** (372,2 s HH, 361,9 s Sepolia). Các ngày sau thêm 950 bundle, và `confirm` tăng ~110–120 s.
- **Sepolia chỉ chậm hơn Hardhat ở bước ký** (chờ giao dịch vào block 17–42 s). Mọi bước còn lại không chạm chain hoặc dùng cache root.

### 5.2 Gas từng đợt (`data/phase3-*/round-gas.json`, đọc receipt từng giao dịch)

| | Hardhat (luật trước fork) | Sepolia (Glamsterdam) |
| --- | --- | --- |
| Đợt đầu mỗi ngày | 591 thu hồi: **15.407.782–15.414.886** gas | 950 thu hồi: **108.449.483–108.460.907** gas |
| Đợt nối tiếp | 359 (hoặc 358) thu hồi: **9.359.407–9.389.698** gas | không cần |
| Event mỗi đợt | 592 / 359–360 (số thu hồi + 1 publish) | 951 |
| Một ngày | ~24,8 triệu | ~108,46 triệu (~54% block 200 triệu) |
| Cả kỳ đo | **545.406.014** (22 ngày, 44 đợt) | **542.293.051** (5 ngày, 5 đợt) |

Từ hai cỡ đợt Hardhat suy ra **~25.970 gas mỗi thu hồi** cộng **~66 nghìn gas cố định mỗi đợt**: (15.414.862 − 9.389.674) / (591 − 359) = 25.971. Số này khớp 25.960 gas "mở word mới" của D91: các thửa bị thu hồi nằm rải trên dải id nên thu hồi nào cũng mở một word bitmap mới. Trên Sepolia chỉ có một cỡ đợt, nên chỉ ước được ~114.000 gas mỗi thu hồi (tổng đợt chia 950, gồm cả phần cố định). Con số này khớp `estimateGas` 114.896 của D91.

### 5.3 `confirm` đang tiêu thời gian vào đâu

`bench:confirm-breakdown` trên 200 thửa (sau tháng Hardhat):

| Bước, cho mỗi thửa | ms (trung bình) | Tỉ trọng | 06/10 |
| --- | --- | --- | --- |
| `proofInOverlay` | 5,8 | 5,3% | 5,4 |
| **Dựng bundle** (receipt, PDF, secret; PDF đo riêng 105,0 ms) | **99,7** | **92,5%** | 104,9 (PDF) |
| Nén ZIP | 2,4 | 2,2% | 2,3 |
| **Tổng mỗi thửa** | **107,8** | | 110,4 |
| × 2.994 thửa (ngày 1) | 323 s | đo thật 372 s | 331 s / 345 s |
| × 3.944 thửa (ngày có cấp lại) | 425 s | đo thật ~485 s | — |

Mỗi thửa chiếm ~38 KB trong ZIP. Phần chênh giữa ước tính và số đo (~50–60 s) nhiều khả năng là ghi DB và ghi archive (chưa tách).

### 5.4 RAM backend

| | Hardhat (22 ngày, 5.009 mẫu) | Sepolia (5 ngày, 1.083 mẫu) |
| --- | --- | --- |
| Trung bình | 1.924 MB | 1.568 MB |
| Đỉnh | **4.297 MB** (một lần, 17:47 ngày 3, trong `confirm`) | 3.528 MB |
| Trên 2 GiB | 20% thời gian | — |
| Trên 3 GiB | 12 mẫu (~24 s) | — |

RAM của chính harness: 401 MB (Hardhat), 342 MB (Sepolia). Không dùng `peakRssMb` của `month.json` làm RAM backend.

---

## 6. Chi phí on-chain

### 6.1 Gas từng thao tác

| Thao tác | Hardhat (luật trước fork) | Sepolia (Glamsterdam) | Ai trả, bao lâu một lần |
| --- | --- | --- | --- |
| Deploy `RootRegistry` | 716.879 | 4.860.941 | một lần |
| Deploy 3 verifier (ownership / mortgage / transfer) | 406.922 / 425.924 / 466.078 | 2.737.714 / 2.873.768 / 3.161.338 | một lần |
| Deploy `LandRegistryVerifier` | 1.014.838 | 6.981.030 | một lần |
| `registerAuthority` | 73.077 | 243.017 | một lần mỗi cơ quan |
| `grantRole` (attester) | 51.507 | 133.527 | một lần |
| `publishRoot` lần đầu | 115.651 | 461.531 | một lần |
| `publishRoot` các lần sau, không thu hồi | **64.339** | chưa đo riêng | ví cán bộ, mỗi đợt |
| Thu hồi một thửa, word mới | ~25.970 (test D91: 25.960) | ~114.000 (`estimateGas` D91: 114.896) | ví cán bộ, trong đợt |
| Thu hồi một thửa, word đã có | 8.860 (test D91) | 16.230 (`estimateGas` D91) | như trên |
| Một đợt 591 / 950 thu hồi | 15,41 triệu / vượt trần 641 nên phải tách | — / 108,46 triệu | ví cán bộ |
| Verify ownership / mortgage / transfer | 255.216 / 262.029 / 267.077 | `eth_call`, không ai trả | người kiểm tra |

Gas deploy trên Sepolia ngày 12/11 trùng từng đơn vị với lần deploy 26/10. Sau Glamsterdam, deploy contract đắt hơn 6,7–6,9 lần, hai lệnh cấp quyền đắt hơn 2,6–3,3 lần và `publishRoot` lần đầu đắt hơn 4 lần, vì mọi slot mới đều tốn thêm state gas (EIP-8037).

### 6.2 Trạng thái fork và trần thu hồi (12/11, ~06:46 UTC)

| | Mainnet | Sepolia |
| --- | --- | --- |
| Glamsterdam (block có `blockAccessListHash`) | **chưa** | **đã** |
| Block gas limit | 60.000.000 | 199.609.379 (block đợt: 200.000.000) |
| Base fee p50 (1.024 block) | 0,0464 gwei | ~0 (17–39 wei) |
| Priority fee p50 | 0,0035 gwei | 1 gwei |
| Trần thu hồi mỗi giao dịch → cap | 641 → **591** (Hardhat) | 1.039 → **989** (`estimateGas`, PASS) |

Mainnet chưa fork, nên **số gas Hardhat là số đúng cho mainnet hôm nay**. Khi mainnet lên Glamsterdam thì dùng số Sepolia.

---

## 7. Cấp proof và cấp xác nhận dưới tải (4,5 triệu lá, sau một tháng)

Mỗi mức gồm 2.000 request trên 2.000 thửa khác nhau rải đều toàn registry. Không có 429 hay 5xx. Vài thửa trong mẫu đã bị thu hồi (9 trên Hardhat, 3 trên Sepolia) nên trả 410, đúng thiết kế.

| Route | Mạng | c=1 | c=4 | c=16 | c=50 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/proof/:id` (200) | Hardhat | 101,6 req/s; p50 10 / p99 14 ms | 208,2; 19 / 26 | 205,0; 78 / 107 | 202,1; 245 / 312 |
| | Sepolia | 91,7; 10 / 14 (max 1.602: lần đọc chain đầu) | 215,6; 18 / 27 | 208,0; 77 / 106 | 200,6; 248 / 309 |
| Có ETag (304) | Hardhat | 340,0; 3 / 5 | 696,9; 5 / 10 | — | 626,4; 78 / 136 |
| | Sepolia | 330,9; 3 / 5 | 659,0; 6 / 11 | — | 646,4; 74 / 161 |
| `GET /api/proof/:id/attestation` | Hardhat | 60,3; 16 / 20 | 189,3; 21 / 30 | 216,9; 73 / 95 | 208,3; 235 / 308 |
| | Sepolia | 140,3; 7 / 9 | 237,0; 16 / 27 | 231,6; 68 / 102 | 229,4; 215 / 272 |

- **Từ c=4 thông lượng chững lại.** Route proof và route xác nhận ở ~190–240 req/s, route 304 ở ~630–700 req/s. Tăng concurrency chỉ làm latency tăng.
- **Hardhat và Sepolia gần như bằng nhau** nhờ cache root có dải stale (D74). Trên Sepolia chỉ có lần đọc root nguội đầu tiên mất 1,6 s.
- **Xác nhận tình trạng trên Hardhat ở c=1 chậm hơn Sepolia** (16 so với 7 ms), giống 06/10. Lượt đo Hardhat chạy ngay sau 22 ngày `confirm`. Giả thuyết là áp lực GC, nhưng **chưa kiểm chứng**.
- Kết quả ngang 06/10 trong phạm vi dao động: các đường này không đổi từ D82.

---

## 8. Chi phí bằng tiền

### 8.1 Đo thật trên Sepolia

| | Số tiền |
| --- | --- |
| Deploy bench (5 contract + `registerAuthority` + `grantRole` + genesis) | 0,009157 ETH |
| 5 đợt (ngày 1–5) | **0,336326 ETH**: 0,000108 / 0,108449 / 0,108461 / 0,010846 / 0,108461 |
| **Tổng chi** | **0,345483 ETH**, khớp số dư ví (7,444357 → 7,098875 ETH) |
| Base fee | 30–39 wei |
| Giá thực trả | 0,001 / 1 / 1 / 0,1 / 1 gwei (ethers tự chọn tip) |
| Trung bình một ngày | 0,067 ETH; **~0,108 ETH nếu tip 1 gwei** |

### 8.2 Ước tính mainnet (suy ra, không phải số đo)

Gas một tháng (22 ngày): **545.406.014** theo luật hiện tại của mainnet (số Hardhat); **2.386.089.424** nếu mainnet dùng luật như Sepolia (22 × trung bình 5 đợt Sepolia). Giá gas lấy từ `eth_feeHistory` 1.024 block mainnet ngày 12/11: base p50 0,0464 + tip p50 0,0035 = **0,0499 gwei**. Tỉ giá: ETH = 2.042,98 USD (Coinbase spot 12/11); 1 USD = 25.656 VND (Coinbase 13/11).

| Kịch bản giá gas | gwei | Luật hiện tại: ETH | USD | VND | Luật như Sepolia: ETH | USD | VND |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Mainnet p50 ngày 12/11** | **0,0499** | **0,0272** | **56** | **1,43 tr** | 0,1191 | 243 | 6,24 tr |
| Mainnet p50 ngày 06/10 | 0,633 | 0,3452 | 705 | 18,10 tr | 1,5104 | 3.086 | 79,17 tr |
| 1 gwei | 1 | 0,5454 | 1.114 | 28,59 tr | 2,3861 | 4.875 | 125,07 tr |
| Mạng bận | 5 | 2,7270 | 5.571 | 142,94 tr | 11,9304 | 24.374 | 625,34 tr |
| Mạng rất bận (mức 2021–2022) | 20 | 10,9081 | 22.285 | 571,75 tr | 47,7218 | 97.494 | 2.501 tr |

Quy về từng thao tác ở 0,0499 gwei:

| Thao tác | Gas | USD | VND |
| --- | --- | --- | --- |
| Một đợt 591 thu hồi (luật hiện tại) | 15.414.862 | 1,57 | ~40.300 |
| Một thu hồi (luật hiện tại) | ~25.970 | 0,0027 | ~68 |
| `publishRoot` không thu hồi | 64.339 | 0,0066 | ~168 |
| Một đợt 950 thu hồi (luật như Sepolia) | 108.460.883 | 11,06 | ~283.700 |
| Một thu hồi (luật như Sepolia) | ~114.000 | 0,0116 | ~298 |
| Chuyển nhượng, cấp lại (biên trong đợt) | ~0 | — | — |
| Verify (`eth_call`) và xác nhận tình trạng (ký off-chain) | 0 | — | — |

⚠️ Hai lưu ý khi trích dẫn:
- **Giá gas mainnet ngày 12/11 thấp hơn ngày 06/10 khoảng 13 lần.** Muốn so với 06/10 thì dùng cùng mức giá: ở 0,633 gwei, tháng này tốn 0,345 ETH cho 20.890 thu hồi, so với 0,194 ETH cho 3.300 thu hồi ngày 06/10.
- **Cột "luật như Sepolia" là ước tính có điều kiện:** giả định mainnet dùng cùng tham số EIP-8037 như Sepolia, và block mainnet đủ lớn cho một giao dịch 108 triệu gas.

---

## 9. Phát hiện và đề xuất (xếp theo tác động)

| # | Vấn đề | Bằng chứng | Đề xuất |
| --- | --- | --- | --- |
| 1 | **`confirm` 485 s/ngày, ~93% là dựng bundle (PDF); RAM vọt 4,2 GiB** | §5.3, §5.4 | Như 29/09 và 06/10: không render PDF trong `confirm`, chỉ lưu receipt và secret, render khi tải archive; hoặc dùng worker pool. Theo quyết định đã chốt, lần này giữ nguyên và ghi thành phát hiện |
| 2 | **Hai đợt mỗi ngày theo luật gas hiện tại của mainnet** | §5.2: 591 + 359 | Không cần sửa code: đợt nối tiếp đã chạy đúng. Ghi vào thesis là cán bộ ký 2 lần/ngày trên mạng chưa fork, 1 lần trên mạng đã fork |
| 3 | **Phí Sepolia do tip quyết định** | §8.1: 0,001–1 gwei giữa các ngày | Khi cần so sánh chi phí giữa các lần đo, đặt `maxPriorityFeePerGas` cố định trong `sign:root`; còn khi báo cáo thì dùng gas, rồi nhân với giá |
| 4 | **Tạo nháp đợt chậm lên ~4,7 lần so với 06/10** | §5.1: 3,7 → 17,4 s mỗi đợt; số lá đổi chỉ ×1,56 | **Đã giải thích (A3, §14.2):** 88% là chiếu root (đọc node + băm). Code của cây không đổi từ 06/10; harness cũ lấy 86.758 thửa **đầu tiên** theo id nên thửa đổi dồn một góc cây, harness mới rải khắp thành phố. Số 06/10 là số lạc quan |
| 5 | **`tree:bootstrap` không thoát khi không có node chain** | §2.4 | Gọi `process.exit()` sau khi in kết quả, hoặc không khởi tạo ChainModule trong script này |
| 6 | `month.json` ghi `publishes` theo ngày | §2.3 | Đếm theo đợt (`rounds`) trong harness |
| 7 | Archive ~146 MB/ngày | §4 | Đường xoá archive hết hạn (`purgeExpired` khi `confirm` hoặc khi liệt kê archive) chưa được bench chạy tới, vì 22 ngày nén trong 3 giờ |
| 8 | **Xác nhận tình trạng mới ký bị contract từ chối trong khoảng một block** (A6, §14.6) | Backend nhận, contract báo `InvalidAttestation`; đào thêm một block thì contract nhận | Backend ký `expiresAt = giờ máy + 600`, đúng trần `block.timestamp + 600` của contract. Ký với hạn ngắn hơn trần (ví dụ 540 s), hoặc cho contract khoảng lệch nhỏ. Trên mạng thật cửa sổ ≤ ~12 s cộng lệch đồng hồ; trên Hardhat kéo dài tới giao dịch kế tiếp |
| 9 | **Import 50 nghìn dòng mất 108,7 s, sát trần 120 s của transaction** (A5, §14.5) | 10 nghìn dòng 10,4 s; 50 nghìn dòng 108,7 s (không tuyến tính) | Hướng dẫn chia tệp ≤ 20 nghìn dòng, hoặc ghi theo lô nhiều transaction. Chưa thử tệp lớn hơn 50 nghìn |
| 10 | **Transaction ghi của `confirm` có ít dư địa so với trần 120 s** (A1, §14.1) | Bảng `properties` phình gấp đôi → transaction chạy 325,9 s, bị huỷ sau khi root đã lên chain | Trên DB khoẻ thì vừa (ước ~50–60 s mỗi ngày, §5.3), nhưng một DB phình hay đang vacuum đủ đẩy nó quá trần và để chain đi trước DB. Giữ autovacuum, theo dõi thời gian transaction, và cân nhắc ghi theo lô hoặc nâng trần. Đường phục hồi (gọi lại `confirm`, cổng `ChainAheadOfDatabase` ở Chốt sổ) chưa được chạy thử |
| 11 | Archive theo 38 chi nhánh làm `confirm` dài thêm ~12–14% | §14.1 | Chấp nhận được; dung lượng không đổi |

Đã giải quyết so với 06/10: cap thu hồi không còn vượt block sau Glamsterdam (D91), và hàng chờ thu hồi không còn dâng.

---

## 10. Giới hạn của phép đo

- **Một máy, Postgres cấu hình mặc định, RPC Alchemy gói free.** Gas đúng với EVM; thời gian đúng với cấu hình ở đầu báo cáo.
- **Sepolia chỉ có 5 ngày**, và tip thay đổi theo ngày (§8.1). Thời gian chờ block chỉ có 5 mẫu.
- **Hardhat 2.28 chưa mô phỏng Glamsterdam.** Số Hardhat là luật trước fork, tức luật của mainnet hôm nay.
- **Proof chuyển nhượng không được sinh trong replay**; prove trong browser chưa đo.
- **Một archive mỗi đợt** trong tháng đo vì seed không gán chi nhánh; trường hợp 38 chi nhánh đo riêng ở A1 (§14.1).
- **Cây được dựng lại sau sự cố tắt máy** (§2.4). A2 (§14.2) đã kiểm lại: dựng lại cả cây từ dữ liệu sau tháng ra đúng root đã publish, và 2.991/2.991 proof lấy mẫu khớp `latestRoot`.
- **Chi phí mainnet là số suy ra** từ gas đo được và giá gas một ngày.

---

## 11. Việc chưa làm

**Cập nhật 15/11:** A1–A6 ở §11.2 đã chạy (kết quả ở §14). Phần làm tay được viết lại thành một lộ trình có giải thích
từng cơ chế, kèm bảng case tấn công đã chứng minh tự động: [`VIEC-THU-CONG.md`](VIEC-THU-CONG.md). Bảng dưới giữ để
đối chiếu.

### 11.1 Bạn phải làm bằng tay (cần MetaMask, trình duyệt hoặc quyết định của bạn)

| # | Việc | Vì sao không tự động được | Làm thế nào | Kết quả cần ghi |
| --- | --- | --- | --- | --- |
| M1 | **Demo portal trên local**: `PHASE_8_MANUAL_TEST.md`, `PHASE_9_MANUAL_TEST.md`, `PHASE_10_MANUAL_TEST.md` (ba profile trình duyệt: CN01, CN02, trung tâm) | Mỗi đợt vào sổ cần MetaMask ký `publishRoot` / `publishRootWithRevocations` | Chạy theo từng runbook; điền mục "Số đo cần ghi"; sửa dòng "Trạng thái: chưa chạy thật" khi xong | Gas từng đợt, số chữ ký MetaMask, thời gian tạo đợt, thời gian proof chuyển nhượng trong browser, thời gian `seed:land-offices` |
| M2 | **Demo trên Sepolia**: `DEMO_SEPOLIA.md` §1–8 | Như M1, và tốn Sepolia ETH | Nếu dùng lại contract 26/10 thì các id 201–210 phải chưa từng bị thu hồi trên contract đó (nếu không sẽ gặp `AlreadyRevoked`); hoặc deploy mới | Tx hash, `rootVersion`, link Etherscan |
| M3 | **Ảnh chụp cho Chương 5** | Cần màn hình thật | Trong lúc làm M1, M2 | `fig:r-import`, `fig:r-round` (gồm popup MetaMask), `fig:r-archive`, `fig:r-prove`, `fig:r-verify-ok`, `fig:r-counter`, `fig:r-attack-window`, `fig:r-superseded`, `fig:r-revoked`, `fig:r-lineage`, `fig:r-scope`, `fig:r-operations`; thêm Etherscan (event `PropertyRevoked`) và tab Network |
| M4 | **Thời gian proof trong browser** (UC-5 ownership và clean-title, proof chuyển nhượng ở quầy, UC-6 verify off-chain và on-chain) | Cần bundle thật từ M1/M2 và trình duyệt | 5 lần mỗi loại trên Chrome và Firefox (hoặc Edge); tách lần đầu (bật "Disable cache", có tải zkey) khỏi các lần sau; báo trung vị | Thời gian hiện trên màn hình kết quả; thời gian tải zkey 6,2 / 6,2 / 12,3 MB |
| M5 | **Kiểm tab Network** | Cần DevTools | Trên trang resident, lọc `ownerSecret`, chuỗi địa chỉ và giá trị `area` lấy từ `receipt.json` | Phải ra 0 kết quả; ở quầy chỉ có `POST /api/transfers/preview` và `POST /api/transfers` đi ra. Chụp màn hình |
| M6 | **Các case tấn công cần trạng thái demo** | Dựa vào bundle, đợt vào sổ và hồ sơ đang mở của M1/M2 | Bảng ngay dưới | Lệnh, input, output hoặc ảnh cho từng case |
| M7 | **Phía thesis** | Quyết định của bạn | Gửi link các bài báo cho ước tính TP.HCM (2,5 triệu thửa, 4,5 triệu GCN); chỉ giữ câu "tested end to end" trong abstract sau khi M1, M2 xong | — |

Các case tấn công của M6:

| Case | Cách làm | Kết quả mong đợi |
| --- | --- | --- |
| (a) Bán hai lần trong lúc chờ đợt vào sổ | `DEMO_SEPOLIA.md` §8.4 bước 3 (`proof:bodies`, rồi UC-6 và `curl` với `onChain: true`) | UC-5 dừng ở `procedure-open`; UC-6 đỏ; API trả 422 `InvalidAttestation` |
| (b) Chủ bị thu hồi đem sổ đi vay | §8.5 bước 2 | như (a) |
| (c) Chủ cũ sau đợt vào sổ | §8.6 bước 3; thêm: verify một proof tạo **trước** đợt, sau khi đợt đã publish | UC-5 báo sổ không còn hiệu lực; proof cũ `RootMismatch` |
| (d) Thửa đã thu hồi | §8.6 bước 3 | `GET /api/proof/<id>` trả 410; `isRevoked` là true; UC-6 từ chối kèm mã lý do |
| (e) Phát lại proof cũ | Giữ một `proof.json` quá 10 phút rồi verify ở UC-6 và qua API với `onChain: true` | `StaleTimestamp` ở cả hai |
| (f) Sửa hồ sơ trong receipt | Sửa `record.area` trong bản sao `receipt.json`, chạy `pnpm --filter blockchain run receipt:verify <file>`, nạp vào UC-5 | Leaf tính lại không khớp; UC-5 báo tệp không toàn vẹn |
| (h) Chi nhánh làm ngoài địa bàn | `PHASE_10_MANUAL_TEST.md` bước 3 | 403 `OutsideOfficeArea` |
| (i) Chuyển nhượng đất cộng đồng | `DEMO_SEPOLIA.md` §8.4 bước 4 | Quầy từ chối |
| (j) Ví không có quyền publish | Đổi sang tài khoản MetaMask khác ở trang Chốt sổ | Portal chặn trước khi mở ví; contract revert |
| (l) Từ chối hồ sơ là mở khoá | `DEMO_SEPOLIA.md` §8.7 | Sau khi từ chối, chủ tạo proof lại được ngay |
| (n) Quét API | Gửi hơn 60 request trong một phút từ một IP (backend chạy throttle mặc định, không phải `THROTTLE_LIMIT=1000000` của bench) | 429 |

Đã có bằng chứng (không cần làm lại):

| Case | Bằng chứng |
| --- | --- |
| (m) API công khai lộ hồ sơ | [`data/attacks/m-public-api.txt`](data/attacks/m-public-api.txt): `GET /api/records?take=3` chỉ trả `propertyId`, `ownerCommitment`, `status`, `leaf`, `rootVersion`; `GET /api/government/properties/1` không có key trả 401 |
| (k) Thu hồi một thửa hai lần | Test "rejects revoking the same property twice" (`data/phase1/tests-blockchain.txt`, dòng 123) |
| (g) Cơ quan phát hành giả cùng tên | `issuer-chain.test.ts`: "fails a certificate from a look-alike root with the same name", "fails a self-signed certificate"; 401/401 test frontend pass, không test nào tự bỏ qua |

### 11.2 Chưa làm nhưng agent chạy được (tuỳ chọn) — đã chạy 15/11, xem §14

| # | Việc | Cách làm |
| --- | --- | --- |
| A1 | **G3: archive theo 38 chi nhánh** | Gán `landOfficeId` cho thửa lúc seed, chạy lại vài ngày, đo thời gian `confirm` và dung lượng khi một đợt ra 38 ZIP |
| A2 | **G4: kiểm đúng đắn cây ở 4,5 triệu** | Script nhỏ: lấy N id, gọi `GET /api/proof/:id`, dựng lại root bằng `verifyMerkleProof` của `blockchain/shared`, so với `latestRoot` (lần 23/09 làm tay ở 2,5 triệu: 40/40) |
| A3 | Tách các bước của `createDraft` | Giải thích phát hiện #4 |
| A4 | Publish không phụ thuộc N trên code cuối | Seed 100 nghìn thửa `LAYOUT=contiguous` và `scattered`, chạy vài ngày, so `confirm` với registry lớn |
| A5 | Tốc độ import | Dry-run rồi import một CSV ~10 nghìn dòng qua `POST /api/government/import` |
| A6 | Case (c), (d), (e), (f) trên Hardhat không cần MetaMask | Dùng `sign:root` thay ví, `owner:smoke`, `receipt:verify`. Không thay được ảnh chụp của M3 |

### 11.3 Dọn máy (khi không cần nữa)

Các DB bench chiếm nhiều chỗ trong volume Postgres của Docker: `land_registry_bench_final` (3,8 GB, bản gốc sau seed), `land_registry_bench_final_hh` (7,2 GB), `land_registry_bench_final_sepolia`, cùng các DB của lần trước (`land_registry_bench45*`, `land_registry_bench82*`, `land_registry_bench`). Muốn xoá thì dùng `docker exec land_registry_postgres dropdb -U postgres <tên>`. Giữ `land_registry_bench_final` nếu muốn chạy lại phần 3 mà không phải seed lại.

---

## 12. Dữ liệu thô

| Số liệu | File |
| --- | --- |
| Test, build, lint, constraint, prove trong Node, kích thước artifact | `data/phase1/` (`tests-*.txt`, `build-*.txt`, `lint-*.txt`, `circuits-compile.txt`, `prove.json`, `bench-prove.txt`, `gas-metrics.json`, `artifact-sizes.txt`) |
| Gas deploy Hardhat, publish lần đầu và sau, trạng thái mạng, giá gas, tỉ giá | `data/phase2/` (`deploy-blocks.json`, `publish-*.txt`, `summary.txt`, `feehistory-*.json`, `latest-block-*.json`, `eth-usd.json`, `usd-rates.json`, `revocation-ceiling-sepolia.txt`, `sepolia-deploy-gas.txt`) |
| Seed 4,5 triệu | `data/phase3-hardhat/` (`seed.json`, `seed.txt`, `bootstrap.txt`, `db-size-seed.txt`, `seed-run-interrupted.log`) |
| Tháng Hardhat | `data/phase3-hardhat/` (`month.json`, `month.txt`, `round-gas.json`, `backend-rss.csv`, `db-size-after.txt`, `genesis.txt`, `deploy.txt`, `backend.log`, `hardhat-node.log`) |
| Tách chi phí `confirm` | `data/phase3-hardhat/confirm-breakdown.txt` |
| Tải proof / 304 / attestation | `data/phase3-{hardhat,sepolia}/proof-load.txt`; JSON gốc từng lượt ở `results/` |
| 5 ngày Sepolia | `data/phase3-sepolia/` (`month.json`, `round-gas.json` có base fee và giá thực trả, `deploy-gas.json`, `balance.txt`, `genesis.txt`, `deploy.txt`, `backend-rss.csv`, `sepolia.json.bench`) |
| File deployment Sepolia của bạn trước khi đo (đã trả lại) | `data/phase3-sepolia/sepolia.json.user` |
| Case tấn công | `data/attacks/`, `data/a6-attacks/` |
| A1 archive theo chi nhánh | `data/a1-branches/` (lần đầu hỏng giữ ở `attempt1-bloated/`) |
| A2 kiểm cây | `data/a2-tree-check/` (`rebuild.txt`, `rebuild-compare.txt`, `tree-check.txt`, `extra-ids.txt`) |
| A3 tách bước tạo nháp | `data/a3-draft-breakdown/` (`draft-breakdown.json`, `month.txt`) |
| A4 độc lập với cỡ sổ | `data/a4-n-independence/{scattered,contiguous}-100k/` |
| A5 import | `data/a5-import/` (`timings.txt`, `import-*-{dry,commit}.json`, `files.txt`) |
| Log điều phối | `data/run-all.log`, `data/run-followups.log`, `data/run-reruns.log`, `data/run-a*.log` |

---

## 13. Tái lập

```bash
pnpm install && pnpm run compile && pnpm run db:up
# Phần 1 và 2 (không tốn ETH)
bash benchmarks/2026-11-12-hcmc-4.5M-final/scripts/run-phase1.sh
bash benchmarks/2026-11-12-hcmc-4.5M-final/scripts/run-network.sh
# Seed một lần (~50 phút), giữ DB này làm bản gốc
docker exec land_registry_postgres createdb -U postgres land_registry_bench_final
export BENCH_DB="postgresql://postgres:postgres@localhost:5433/land_registry_bench_final?schema=public"
DATABASE_URL=$BENCH_DB pnpm --filter backend prisma migrate deploy
DATABASE_URL=$BENCH_DB CHAIN_NETWORK=localhost COUNT=4500000 LAYOUT=scattered pnpm --filter backend run bench:seed
#   → đặt seed.json (có "root") vào benchmarks/2026-11-12-hcmc-4.5M-final/data/phase3-hardhat/
# Phần 3: Hardhat 22 ngày rồi Sepolia 5 ngày (~4,5 giờ; tốn ~0,35 ETH Sepolia)
bash benchmarks/2026-11-12-hcmc-4.5M-final/scripts/run-all.sh > benchmarks/2026-11-12-hcmc-4.5M-final/data/run-all.log 2>&1
```

- `GOV_API_KEY` được đọc từ `web-app/backend/.env`. Script tự đặt `CHAIN_NETWORK`, `RPC_URL`, `REVOCATION_CAP` (591 cho Hardhat, 989 cho Sepolia) và `THROTTLE_LIMIT`.
- Script Sepolia sao lưu `blockchain/deployments/sepolia.json` trước khi deploy và trả lại khi xong, kể cả khi lỗi.
- Script chạy lại được: mỗi lần chạy nhân bản lại DB từ bản gốc. Cổng 3001 và 8545 phải trống.
- **Không chạy `circuits:setup`**: zkey mới sẽ không khớp verifier đã deploy.

Đo bổ sung A1–A6 (§14), mỗi phần độc chiếm máy và cổng 3001/8545; ba biến trỏ ra thư mục ngoài repo vì chứa khoá đơn
vị, tệp CSV sinh ra và bundle có secret:

```bash
KEYS_FILE=<ngoài repo>/office-keys.txt CSV_DIR=<ngoài repo>/csv WORK_DIR=<ngoài repo>/a6 \
  bash benchmarks/2026-11-12-hcmc-4.5M-final/scripts/run-followups.sh > benchmarks/2026-11-12-hcmc-4.5M-final/data/run-followups.log 2>&1
```

Script dùng chung `scripts/lib.sh`; từng phần chạy riêng được bằng `scripts/run-a1-…` đến `run-a6-…`. A2 cần DB
`land_registry_bench_final_hh` (trạng thái sau tháng), các phần khác nhân bản từ bản gốc hoặc tạo DB mới.

---

## 14. Đo bổ sung ngày 15/11 (A1–A6)

Cùng máy, cùng commit, cùng harness của §2 cộng ba tuỳ chọn mới (`SUCCESSOR_OFFSET`, `STOP_BEFORE_DRAFT_DAY`, giấy
cấp lại thừa hưởng chi nhánh của giấy cũ). Script mới: `web-app/backend/scripts/bench-draft-breakdown.ts`,
`blockchain/scripts/bench/treeCheck.ts`, `blockchain/scripts/bench/verifyOnChain.ts`.

### 14.1 A1: mỗi chi nhánh một archive (`data/a1-branches/`)

Bản nhân bản 4,5 triệu giấy, nạp 168 phường/xã và 41 đơn vị, rồi gán mỗi thửa cho một trong 38 chi nhánh theo băm của
`propertyId` (117.885–119.023 thửa mỗi chi nhánh; UPDATE 157 s, rồi `VACUUM FULL` 67 s để bảng về đúng cỡ bản gốc,
1.668 MB). Giấy cấp lại thừa hưởng chi nhánh của giấy cũ. Ba ngày như tháng đo, cap 591.

| | 38 chi nhánh (A1) | Một archive HQ (tháng đo, ngày 1–3) |
| --- | --- | --- |
| Archive mỗi đợt có hồ sơ | **38 ZIP**, 60–104 thửa và 2,2–3,8 MB mỗi ZIP (đợt 1) | 1 ZIP |
| Tổng dung lượng đợt ngày 1 / 2 / 3 | 110,0 / 143,5 / 144,0 MB | 108,0 / 143,0 / 145,3 MB |
| `confirm` ngày 1 / 2 / 3 | **423,7 / 537,9 / 537,7 s** | 372,2 / 479,4 / 479,7 s |
| Tạo nháp ngày 1 / 2 / 3 | 21,4 / 26,1 / 17,8 s | 10,8 / 20,3 / 19,1 s |
| Gas ngày 1 / 2 / 3 | 24.804.620 / 24.793.172 / 24.804.584 | 24.804.536 / 24.793.148 / 24.804.560 |
| RAM backend: đỉnh / trung bình | 2.043 / 998 MB | 4.297 / 1.924 MB (cả tháng) |

- **Tách theo chi nhánh làm `confirm` dài thêm ~12–14%** (+51 đến +58 s mỗi ngày); tổng dung lượng không đổi, vì cùng số bundle
  chỉ chia vào nhiều ZIP. Mỗi chi nhánh chỉ phải tải 2–4 MB mỗi đợt.
- Đỉnh RAM thấp hơn tháng đo, nhưng tháng đo chạy 22 ngày nên không so trực tiếp được.
- **Hai lần chạy đầu không dùng được, giữ một lần làm bằng chứng:**
  - *Lần 1* (`attempt1-bloated/`): UPDATE 4,5 triệu dòng mà không nén lại để bảng phình gấp đôi (3.278 MB). Transaction ghi
    của `confirm` chạy **325,9 s**, vượt trần 120 s của Prisma, bị huỷ **sau khi root đã lên chain**: đúng tình huống "chain
    đi trước DB" (`ChainAheadOfDatabase`). Sau khi nén lại bảng, cùng phép đo chạy bình thường. Phát hiện #10.
  - *Lần 2* hỏng vì tôi xoá nhầm thư mục kết quả đang được ghi; *lần 3* gán chi nhánh theo `id % 38` trùng nhịp với bước
    chọn thửa của harness (mỗi thửa thứ 380 = 38 × 10), nên cả ngày rơi vào một chi nhánh. Không giữ file của hai lần này.

### 14.2 A2: cây ở 4,5 triệu có đúng không (`data/a2-tree-check/`)

**Dựng lại từ đầu trùng với cập nhật dần.** Sau 44 đợt của tháng đo, toàn bộ bảng `merkle_nodes` của DB sau tháng được
xoá và dựng lại từ các dòng `ISSUED` (`tree:bootstrap`): 4.499.051 lá (= 4.500.000 − 20.890 thu hồi + 19.941 cấp lại),
15.747.635 node, 2.311,8 s. Root dựng lại **trùng từng chữ số** với root mà đợt #44 đã publish lên chain. Nghĩa là 44 lần
ghi riêng phần node bị đổi (D72) cho ra đúng cây mà dựng lại từ đầu sẽ cho.

**Proof lấy mẫu.** 3.200 thửa: 2.000 rải đều trên toàn sổ, cộng 500 thửa đã chuyển nhượng, 500 giấy cấp lại và 200 thửa
đã thu hồi trong tháng. Với mỗi thửa còn hiệu lực, lấy proof qua `GET /api/proof/:id` rồi dựng lại root bằng
`verifyMerkleProof` của `blockchain/shared`, so với `latestRoot` đọc thẳng từ contract.

| Kết quả | Số thửa |
| --- | --- |
| Thửa còn hiệu lực trả 200 | 2.991 |
| Dựng lại đúng `latestRoot`, bit đường đi = `propertyId` (D41), root của proof = root trên chain | **2.991 / 2.991** |
| Lá công khai (`/api/records`) trùng lá trong proof | 1.031 / 1.031 thửa có lá công khai |
| Thửa seed bằng SQL, chưa có cột `leaf` công khai (không so được) | 1.960 |
| Thửa đã thu hồi trả 410 | 209 / 209 |
| Id không tồn tại trả 404 | 1 / 1 |
| Lỗi | **0** |

### 14.3 A3: thời gian tạo nháp đi đâu (`data/a3-draft-breakdown/`)

Hàng chờ thật của ngày 2 (sau khi ngày 1 chạy đủ), đo bằng cách bọc thời gian quanh các hàm thật của `ChangeSetService`
(không sửa code sản phẩm); mỗi lần tạo nháp rồi huỷ. Trung bình lượt 2–3 (lượt 1 nguội: 21,4 s). Biến thể "không cấp lại"
tạm giữ 950 đề nghị cấp.

| Bước (ms) | Đủ ngày 2: 950 cấp lại + 2.994 chuyển nhượng + 591 thu hồi | Không cấp lại: 2.994 + 591 |
| --- | --- | --- |
| Đọc hàng chờ, kiểm xung đột, khoá | 81 | 79 |
| Kiểm secret của đề nghị cấp (950 lần Poseidon) | 61 | 0 |
| Kiểm lineage (D90) | 102 | 0 |
| Đọc dòng và tính lá mới | 1.477 | 1.207 |
| **Chiếu root: đọc node anh em từ DB** | **9.375** | **5.419** |
| **Chiếu root: băm Poseidon** | **5.788** | **4.492** |
| Gắn item vào đợt | 308 | 259 |
| Còn lại (khoá, ghi nháp, transaction) | 14 | 14 |
| **Tổng** | **17.204** | **11.469** |

- 88% thời gian là chiếu root. Mỗi lá đổi tốn ~2,1 ms đọc node và ~1,3 ms băm. Các bước riêng của giấy cấp lại (kiểm secret,
  lineage) chỉ tốn ~0,16 s.
- **Vì sao chậm hơn 06/10 (3,6 s):** code của cây không đổi (không có commit nào vào `src/tree/` hay `sparseTree.ts` từ
  06/10). Harness đã commit lấy 86.758 thửa **đầu tiên theo id**, nên mỗi ngày các thửa đổi dồn vào một góc nhỏ của cây và
  dùng chung phần lớn node trên đường lên gốc. Harness bây giờ rải thửa đổi khắp sổ, đúng với một thành phố thật, nên
  hầu như mỗi lá có đường riêng. Số 06/10 lạc quan; số 12/11 mới là số nên trích.

### 14.4 A4: chi phí một ngày có phụ thuộc cỡ sổ không (`data/a4-n-independence/`)

Cùng ba ngày (2.994 chuyển nhượng + 950 thu hồi + 950 cấp lại từ ngày 2), cap 591, trên 100 nghìn thửa id rải (bước 167),
100 nghìn thửa id liền kề, và ba ngày đầu của tháng 4,5 triệu.

| | 100k rải | 100k liền kề | 4,5 triệu rải |
| --- | --- | --- | --- |
| Seed: nạp dòng / dựng cây / node | 21,1 s / 102,8 s / 930.472 | 20,6 s / 37,1 s / 200.018 | 962,1 s / 2.112,5 s / 15.750.005 |
| Tạo nháp ngày 1 / ngày 2 / ngày 3 (s, 2 đợt) | 12,4 / 11,3 / 11,5 | 9,1 / 8,4 / 8,7 | 10,8 / 20,3 / 19,1 |
| `confirm` ngày 1 / 2 / 3 (s) | 363,0 / 463,0 / 461,4 | 363,8 / 456,3 / 455,8 | 372,2 / 479,4 / 479,7 |
| Gas ngày 1 / 2 / 3 | 24.804.608 / 24.793.184 / 24.804.596 | 12.094.736 / 5.756.348 / 5.772.548 | 24.804.536 / 24.793.148 / 24.804.560 |

- **`confirm` không phụ thuộc cỡ sổ** (lệch ≤ 3,6% giữa 100 nghìn và 4,5 triệu): nó bị PDF chi phối.
- **Gas không phụ thuộc cỡ sổ**, chỉ phụ thuộc số thu hồi và cách id nằm: 100 nghìn rải và 4,5 triệu rải lệch nhau dưới
  100 gas mỗi ngày.
- **Id liền kề rẻ hơn 2–4 lần** vì các thu hồi gần nhau dùng chung một word 256 bit của bitmap (D91); từ ngày 2 phần lớn
  word đã mở. Tạo nháp cũng nhanh hơn vì đường lên gốc dùng chung node.
- **Tạo nháp ở 4,5 triệu chậm hơn ~1,7 lần ở những ngày có cấp lại** (19–20 s so với 11–12 s), dù số node phải đọc và băm
  như nhau. Giả thuyết: bảng node 2,1 GB không nằm gọn trong bộ đệm của Postgres (mặc định 128 MB), còn bảng 100 nghìn thì
  vừa. **Chưa tách được**; ngày 1 không thấy khác biệt này.

### 14.5 A5: tốc độ import CSV (`data/a5-import/`)

Tệp sinh bằng `mock:generate` (14 mã đất, địa chỉ ở 10 phường/xã thật), nhập vào registry mới đã có danh mục 168
phường/xã và 41 đơn vị. Thời gian là thời gian HTTP của `POST /api/government/import`.

| Số dòng | Kích thước | Dry-run | Nhập thật | Kết quả |
| --- | --- | --- | --- | --- |
| 1.000 | 0,24 MB | 0,31 s | 0,71 s | 1.000 dòng, 0 lỗi, 6 chi nhánh |
| 10.000 | 2,4 MB | 3,52 s | 10,38 s | 10.000 dòng, 0 lỗi |
| 50.000 | 12,0 MB | 10,05 s | **108,65 s** | 50.000 dòng, 0 lỗi |

Mọi dòng đều được gán đúng chi nhánh theo phường/xã. Nhập thật không tuyến tính (10 nghìn: ~960 dòng/s; 50 nghìn:
~460 dòng/s), và phần ghi nằm trong một transaction có trần 120 s (`PrismaService`), nên một tệp lớn hơn ~50 nghìn dòng
nhiều khả năng sẽ hỏng (chưa thử). Phát hiện #9.

### 14.6 A6: case tấn công trên Hardhat, không cần MetaMask (`data/a6-attacks/`)

Registry 10 thửa (`demoImport.csv`, 201–210), cấp qua API, `sign:root` thay ví, rồi chuyển nhượng 201 (`transfer:smoke`),
thu hồi 203. Đối chứng: bundle thật của 206 qua cả 10 mục của `receipt:verify` (kể cả chuỗi D30) và proof hợp lệ được
backend chấp nhận.

| Case | Kết quả | File |
| --- | --- | --- |
| (a) Bán hai lần trong lúc chờ | Hồ sơ mở → xác nhận tình trạng bị từ chối, 409 `ProcedureOpen` | `c-transfer-smoke.txt` |
| (b) Chủ bị thu hồi đem sổ đi vay | Xác nhận bị từ chối; body không xác nhận → backend 422 `InvalidAttestation`, contract `AttestationExpired` | `b-*.txt` |
| (c) Chủ cũ sau đợt vào sổ | Trước đợt: proof hợp lệ cả 5 bước. Sau đợt: `RootMismatch` ở backend và contract. Chủ cũ: lá đã đổi, prover dừng. Người mua prove được | `c-*.txt` |
| (d) Thửa đã thu hồi | 410; `isRevoked(203) = true`, `isRevoked(206) = false`; lịch sử REVOKED ở v3 với mã lý do 1 và băm, không có văn bản; đợt 1 thu hồi 92.008 gas | `d-*.txt`, `round3-*.json` |
| (e) Phát lại proof cũ | Sau 666 s: backend `StaleTimestamp` (off-chain và on-chain); contract `StaleTimestamp` (674 s) | `e-*.txt` |
| (f) Sửa diện tích trong receipt (980 → 981) | `receipt:verify` hỏng đúng mục "record matches the certified leaf — ALTERED", 9 mục khác xanh; prover dừng ở ràng buộc circuit | `f-tamper.txt` |
| (n) Quét API, throttle mặc định | 70 request dồn: 60 × 200, 10 × 429 | `n-throttle.txt` |

**Phát hiện #8.** Cùng một proof hợp lệ, vừa tạo: backend chấp nhận ở bước off-chain, contract báo `InvalidAttestation`
(`e-verify-fresh.txt`); đào thêm một block rồi gọi lại thì contract chấp nhận (`e-chain-fresh.txt`: block có timestamp
1794735721, `expiresAt` 1794736311, cách 590 s). Nguyên nhân ở §9 #8. `owner:smoke` gặp cùng hiện tượng ở bước on-chain
(`baseline-owner-smoke-206.txt`, `c-new-owner-smoke.txt`).

Hai lần chạy hỏng đầu tiên (file không giữ lại vì không có giá trị bằng chứng): A5 lần 1 không gửi được tệp (`curl` không đọc được đường dẫn kiểu `/c/...`);
A6 lần 1 deploy local cấp quyền attester cho địa chỉ Sepolia đọc từ `.env` gốc. Cả hai là lỗi của script đo, đã sửa.
