# Deployment Guide — Land Registry ZKP (Phase 4 contracts)

Hướng dẫn deploy bộ contract on-chain theo đúng 3 giai đoạn: **local → Sepolia thử → Sepolia chính thức**.

Mọi lệnh chạy từ **thư mục gốc repo** trừ khi ghi rõ khác. Ví dụ:

    cd <path-to>/land-registry-zkp

⚠️ Chạy `pnpm --filter blockchain ...` từ ngoài repo (ví dụ terminal vừa mở, đang ở `C:\Users\<bạn>`) sẽ báo **`No projects matched the filters`** — pnpm đi ngược lên tìm workspace và vớ phải workspace khác trên máy. Không phải lỗi cấu hình, chỉ là đứng sai chỗ.

| Giai đoạn | Mạng | Mục đích | Mất gì |
|---|---|---|---|
| 1 | Hardhat node local | Xem hệ thống chạy, test tay, debug thoải mái | Không mất gì, reset tuỳ ý |
| 2 | Sepolia (lần thử) | Kiểm tra deploy thật, verify source, đo gas thật | ETH testnet (miễn phí từ faucet) |
| 3 | Sepolia (chính thức) | Bản demo dùng cho thesis/bảo vệ | ETH testnet + **địa chỉ này phải giữ ổn định** |

Bộ contract deploy gồm **5 cái** (kiến trúc D12):

```
RootRegistry                 ← lưu Merkle root + rootHistory + anchor danh tính cơ quan (D30)
Groth16VerifierOwnership     ← auto-generated từ .zkey, KHÔNG viết tay
Groth16VerifierMortgage      ← auto-generated
Groth16VerifierTransfer      ← auto-generated
LandRegistryVerifier         ← dispatcher: gọi đúng verifier + đối chiếu root + check timestamp
```

---

## 0. Chuẩn bị một lần (bắt buộc trước mọi giai đoạn)

### 0.1 Dependencies

```bash
pnpm install
```

`circom` là **binary Rust**, không phải npm package. Kiểm tra:

```bash
circom --version
```

Nếu chưa có: `cargo install circom` (máy này đã có sẵn circom 2.2.3).

### 0.2 Sinh artifacts mật mã — **không bỏ qua được**

3 file `Groth16Verifier*.sol` là **gitignored** (quyết định D32): chúng chứa verification key bake ra từ `.zkey`, mà `.zkey` sinh lại với entropy mới mỗi lần. Fresh clone **không có** chúng → phải tự sinh:

```bash
pnpm --filter blockchain run circuits:compile
```

```bash
pnpm --filter blockchain run circuits:setup
```

`circuits:setup` mất vài phút lần đầu (tải file `.ptau` ~18MB + ~36MB, có cache). Nó tự chạy `verifiers:sync` để copy + đổi tên 3 contract vào `blockchain/contracts/verifiers/`.

Kiểm tra đã có đủ:

```bash
ls blockchain/contracts/verifiers/
```

Phải thấy `Groth16VerifierOwnership.sol`, `Groth16VerifierMortgage.sol`, `Groth16VerifierTransfer.sol`.

### 0.3 Compile + test

```bash
pnpm run compile
```

```bash
pnpm run test:blockchain
```

Kỳ vọng **99 passing**. Nếu ra 83 passing + 16 pending nghĩa là artifacts ở bước 0.2 chưa xong — quay lại làm.

---

## 1. Giai đoạn 1 — Deploy local

### 1.1 Cách nhanh: smoke deploy (ephemeral)

```bash
pnpm --filter blockchain run deploy:local
```

Chạy trên mạng `hardhat` in-process — deploy xong là **contract biến mất** cùng process. Chỉ dùng để xác nhận script deploy không lỗi, **không** dùng để test tay.

### 1.2 Cách dùng thật: node persistent (2 terminal)

⚠️ Terminal mới mở luôn nằm ở thư mục home (`C:\Users\<bạn>`), mà ở đó `pnpm --filter` sẽ báo `No projects matched the filters` — nó đi tìm workspace khác. **Luôn `cd` vào repo trước**, nên các lệnh dưới đây có sẵn `cd`.

**Terminal 1** — mở node và để chạy:

```bash
cd D:\thesis\land-registry-zkp; pnpm --filter blockchain run node
```

Node lắng nghe ở `http://127.0.0.1:8545`, chainId **31337**, in ra 20 account test kèm private key (10000 ETH mỗi cái). Đừng đóng terminal này — đóng là contract mất sạch.

**Terminal 2** — deploy vào node đó:

```bash
cd D:\thesis\land-registry-zkp; pnpm --filter blockchain run deploy:localhost
```

Output mẫu (địa chỉ local là tất định, deploy lại luôn ra y hệt):

```
RootRegistry             0x5FbDB2315678afecb367f032d93F642f64180aa3
Groth16VerifierOwnership 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
Groth16VerifierMortgage  0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
Groth16VerifierTransfer  0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
LandRegistryVerifier     0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9

STATE_AUTHORITY_ROLE + authorityInstitute anchored for 0xf39Fd...92266
deployment record → deployments\localhost.json
```

### 1.3 Kiểm tra deployment (read-only, không tốn gas)

```bash
pnpm --filter blockchain run smoke:localhost
```

Script đọc `deployments/localhost.json` rồi kiểm: contract có code thật không, `rootVersion`/`latestRoot`, cơ quan có `STATE_AUTHORITY_ROLE` chưa, `authorityInstitute` có khớp `keccak256(orgName)` không (D30), và dispatcher có trỏ đúng 3 verifier không.

### 1.4 Chạy vòng đầy-đủ: publish root + tạo proof thật + verify on-chain

```bash
$env:SMOKE_PUBLISH='1'; pnpm --filter blockchain run smoke:localhost
```

(Git Bash: `SMOKE_PUBLISH=1 pnpm --filter blockchain run smoke:localhost`)

Đây là màn demo đầu-cuối: dựng cây Merkle thật từ mock record → `publishRoot()` → sinh Groth16 proof bằng snarkjs → gọi `verifyOwnership()` on-chain.

```
publishing root 0x129560a3...e544 ...
tx 0x664c90db...0e00c  gas 115577
rootVersion is now 1
generating ownership proof (snarkjs) ...
proof generated in 6948 ms
on-chain verifyOwnership → true  (gas 245947)
```

Nhớ tắt biến môi trường khi không cần nữa: `$env:SMOKE_PUBLISH=''`

### 1.5 Nối MetaMask vào node local (nếu muốn bấm tay)

- Network name: `Hardhat local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: `ETH`

Import private key của account #0 mà terminal 1 in ra (`0xac09...ff80`). ⚠️ Key này công khai toàn thế giới — **tuyệt đối không** gửi tiền thật vào.

### ⚠️ Gotcha local

Tắt/restart node ở terminal 1 là **toàn bộ contract biến mất**, nhưng `deployments/localhost.json` vẫn còn → mọi lệnh sẽ báo *"No contract code at 0x..."*. Cứ deploy lại (bước 1.2) là xong.

---

## 2. Giai đoạn 2 — Deploy Sepolia (lần thử)

### 2.1 Điền `.env` ở gốc repo

```bash
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<API_KEY_CUA_BAN>
PRIVATE_KEY=0x<private_key_vi_deployer>
ETHERSCAN_API_KEY=<key_tu_etherscan>
```

- `SEPOLIA_RPC_URL`: tạo app Sepolia miễn phí ở [Alchemy](https://alchemy.com) hoặc [Infura](https://infura.io).
- `PRIVATE_KEY`: **ví riêng cho dev**, không dùng ví có tiền thật. Export từ MetaMask (Account details → Show private key).
- `ETHERSCAN_API_KEY`: lấy free ở https://etherscan.io/myapikey — chỉ cần cho bước verify source ở 2.5.

Hai biến tuỳ chọn (mặc định lấy chính deployer + tên mock):

```bash
AUTHORITY_ADDRESS=          # để trống = dùng luôn địa chỉ deployer
AUTHORITY_ORG_NAME="So Tai nguyen va Moi truong TP.HCM"
```

`AUTHORITY_ORG_NAME` sẽ được `keccak256` rồi neo on-chain (D30) — **phải khớp field Subject `O` của X.509 certificate** mà verifier portal dùng ở Phase 9. Đổi tên này sau khi deploy = phải deploy lại hoặc gọi `registerAuthority` lần nữa.

### 2.2 Xin ETH testnet

Cần khoảng **0.05 Sepolia ETH** là dư (5 contract, trong đó 3 verifier khá to). Faucet:
- https://sepoliafaucet.com (Alchemy, cần đăng nhập)
- https://www.infura.io/faucet/sepolia
- https://faucets.chain.link/sepolia

Kiểm tra số dư đã về chưa bằng chính script deploy — nó in `balance:` ở dòng đầu.

### 2.3 Deploy

```bash
pnpm --filter blockchain run deploy:sepolia
```

Chậm hơn local nhiều (mỗi contract chờ 1 block ~12s). Script ghi `blockchain/deployments/sepolia.json` với đủ 5 địa chỉ + thông tin authority.

### 2.4 Kiểm tra

```bash
pnpm --filter blockchain run smoke:sepolia
```

Rồi vòng đầy đủ (tốn thêm 1 tx):

```bash
$env:SMOKE_PUBLISH='1'; pnpm --filter blockchain run smoke:sepolia
```

### 2.5 Verify source code trên Etherscan

Deploy script in sẵn các lệnh ở cuối output, dạng:

```bash
npx hardhat verify --network sepolia <ROOT_REGISTRY_ADDRESS> <DEPLOYER_ADDRESS>
```

Chạy từ thư mục `blockchain/`. Verify xong thì lên Etherscan đọc được source + bấm nút `Read/Write Contract` — rất tiện để demo/chụp hình cho thesis.

3 verifier không có constructor argument nên chỉ cần địa chỉ. Riêng dispatcher cần 4 argument:

```bash
npx hardhat verify --network sepolia <LAND_REGISTRY_VERIFIER> <ROOT_REGISTRY> <V_OWNERSHIP> <V_MORTGAGE> <V_TRANSFER>
```

---

## 3. Giai đoạn 3 — Deploy Sepolia chính thức

Về mặt kỹ thuật giống hệt giai đoạn 2 — khác ở chỗ **địa chỉ lần này phải giữ nguyên** cho tới lúc bảo vệ thesis.

### ⚠️⚠️ Điều quan trọng nhất: sau khi deploy chính thức, ĐỪNG chạy lại `circuits:setup`

`circuits:setup` sinh `.zkey` mới với entropy ngẫu nhiên mới → verification key đổi → **3 contract verifier đã deploy trên Sepolia sẽ từ chối mọi proof sinh bằng zkey mới**. Mà `.zkey`/`.wasm` đều gitignored, không có trong git.

Nghĩa là: **bộ `blockchain/circuits/build/` trên máy bạn là thứ duy nhất khớp với contract đã deploy.** Mất nó là deployment chính thức thành vô dụng, phải deploy lại từ đầu.

👉 **Ngay sau khi deploy chính thức, backup cả thư mục `blockchain/circuits/build/`** (copy ra ổ khác / Google Drive / USB). Đây không phải chuyện cẩn thận thừa — nó là điểm gãy thật của thiết kế D32, và nên ghi vào phần Limitations của thesis.

### 3.1 Checklist trước khi bấm deploy

- [ ] `pnpm run test:blockchain` ra đủ **99 passing**
- [ ] Giai đoạn 2 đã chạy trơn, kể cả `SMOKE_PUBLISH=1` và verify Etherscan
- [ ] `AUTHORITY_ORG_NAME` trong `.env` đã là tên cuối cùng (khớp X.509 sẽ dùng ở Phase 9)
- [ ] Ví deployer còn ≥ 0.05 Sepolia ETH
- [ ] Đã chốt sẽ **không** chạm vào `circuits:setup` nữa

### 3.2 Deploy + lưu vết

```bash
pnpm --filter blockchain run deploy:sepolia
```

⚠️ Lệnh này **ghi đè** `blockchain/deployments/sepolia.json` của lần thử trước. Nếu muốn giữ bản ghi lần thử, copy nó ra chỗ khác trước.

Sau đó commit bản ghi (file này **được** track, khác với `localhost.json`/`hardhat.json`):

```bash
git add blockchain/deployments/sepolia.json && git commit -m "chore: record official Sepolia deployment"
```

### 3.3 Cập nhật biến môi trường cho app

Trong `.env`:

```bash
NEXT_PUBLIC_CONTRACT_ADDRESS=<địa chỉ RootRegistry mới>
```

📌 Frontend Phase 9 (verifier portal) sẽ cần thêm địa chỉ `LandRegistryVerifier` để verify on-chain — hiện **chưa có biến env cho nó**. Khi vào Phase 9 nhớ thêm `NEXT_PUBLIC_VERIFIER_ADDRESS` (hoặc đọc thẳng từ `deployments/sepolia.json`).

### 3.4 Backup

```bash
# PowerShell — đổi đích tuỳ bạn
Copy-Item -Recurse blockchain\circuits\build D:\backup\land-registry-circuits-build
```

---

## 4. Số liệu gas tham khảo

Đo trên Hardhat local, solc 0.8.36 + optimizer 200 runs (`blockchain/circuits/build/gas-metrics.json`):

| Thao tác | Gas |
|---|---|
| `publishRoot()` — **lần đầu** (slot `latestRoot` từ 0 → khác 0) | 115.577 |
| `publishRoot()` — **các lần sau** | 64.277 |
| `verifyOwnership()` | ~245.900 |
| `verifyMortgage()` | ~252.600 |
| `verifyTransfer()` | ~267.100 |

📌 Chênh lệch publish lần đầu vs lần sau là do chi phí SSTORE khởi tạo slot (20k gas) — khi lên bảng Chapter 5 nên ghi rõ đang nói con số nào, đừng gộp làm một.

Ba hàm `verify*` là `view` → gọi off-chain (qua RPC) **không tốn gas thật**. Con số trên là `estimateGas`, chỉ có ý nghĩa nếu sau này có contract khác gọi chúng trong một transaction.

---

## 5. Troubleshooting

| Lỗi | Nguyên nhân | Xử lý |
|---|---|---|
| `No projects matched the filters in "C:\Users\..."` | Đang đứng ngoài repo; pnpm tìm workspace khác trên máy | `cd D:\thesis\land-registry-zkp` rồi chạy lại |
| `HH108: Cannot connect to the network localhost` | Chưa mở node ở terminal 1 | `cd D:\thesis\land-registry-zkp; pnpm --filter blockchain run node` |
| `No contract code at 0x...` | Node local đã restart sau khi deploy | Deploy lại (bước 1.2) |
| `Missing contracts/verifiers/Groth16Verifier*.sol` | Chưa chạy trusted setup | Bước 0.2 |
| `HH12: artifact ... not found` | Đã sync verifier nhưng chưa compile | `pnpm run compile` |
| `HH117: Empty string \`\` for network or forking URL` | `SEPOLIA_RPC_URL` rỗng khi Hardhat đọc config — hoặc chưa điền, hoặc `.env` không được nạp | Kiểm tra `.env` ở **gốc repo** có `SEPOLIA_RPC_URL=https://...`; `hardhat.config.ts` phải nạp `path.resolve(__dirname, '../.env')` (một cấp, không phải hai) |
| `insufficient funds for intrinsic transaction cost` | Ví deployer hết Sepolia ETH | Xin faucet (2.2) |
| `Invalid Chai property: revertedWithCustomError` khi chạy test | pnpm giữ 2 bản copy chai | Đã fix sẵn bằng import tường minh trong `hardhat.config.ts` — đừng gỡ dòng đó |
| `Solidity 0.8.36 is not fully supported yet` | Hardhat 2.28.6 ra trước solc 0.8.36 nên chưa có metadata cho nó | Vô hại — chỉ ảnh hưởng stack trace khi debug, không ảnh hưởng bytecode. 99 test vẫn xanh, kể cả các test bắt custom error |
| Etherscan cảnh báo `UnsoundSpillInMutualRecursion` / `LostStorageArrayWriteOnSlotOverflow` | Cảnh báo theo *phiên bản* solc, không phải phân tích code | Đã hết từ khi lên 0.8.36. Kể cả ở 0.8.24 cũng không chạm tới project này: bug 1 cần `viaIR: true` (không bật) + đệ quy tương hỗ (không có), bug 2 cần storage array tràn slot 2^256−1 (contract không có array nào) |
| `hardhat verify` báo thiếu API key | `ETHERSCAN_API_KEY` rỗng | Điền vào `.env` (2.1) |
| `nonce too low` / tx kẹt trên Sepolia | Tx trước chưa mine xong | Chờ, hoặc reset account trong MetaMask |
| Proof verify được off-chain nhưng on-chain revert `InvalidProof` | `.zkey` hiện tại khác `.zkey` lúc deploy verifier | Xem cảnh báo mục 3 — phải deploy lại verifier |
| Revert `StaleTimestamp` | Proof cũ quá 10 phút, hoặc đồng hồ máy lệch | Sinh proof mới; kiểm tra giờ hệ thống |
| Revert `RootMismatch` | Root trong proof không còn là `latestRoot` | Refresh Merkle proof rồi sinh proof lại (D29: chỉ `latestRoot` mới verify được) |

---

## 6. Bảng lệnh nhanh

Mọi lệnh giả định đã `cd D:\thesis\land-registry-zkp`.

```bash
# Chuẩn bị
pnpm install
pnpm --filter blockchain run circuits:compile
pnpm --filter blockchain run circuits:setup      # sinh zkey + sync verifier
pnpm run compile
pnpm run test:blockchain                          # 99 passing

# Local — terminal 1 (để nguyên, đừng đóng)
cd D:\thesis\land-registry-zkp; pnpm --filter blockchain run node
```

```bash
# Local — terminal 2
cd D:\thesis\land-registry-zkp
pnpm --filter blockchain run deploy:localhost
pnpm --filter blockchain run smoke:localhost      # read-only
$env:SMOKE_PUBLISH='1'; pnpm --filter blockchain run smoke:localhost   # vòng đầy đủ
$env:SMOKE_PUBLISH=''                             # tắt lại khi xong
```

```bash
# Sepolia
pnpm --filter blockchain run deploy:sepolia
pnpm --filter blockchain run smoke:sepolia
cd blockchain; npx hardhat verify --network sepolia <address> <args...>
```
