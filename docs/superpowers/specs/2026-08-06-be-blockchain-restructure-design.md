# Sắp xếp lại cấu trúc backend + blockchain

**Ngày:** 2026-08-06
**Branch:** `feat/phase-5`
**Phạm vi:** `blockchain/` và `web-app/backend/`. Frontend không đụng tới.

## Vấn đề

Kiến trúc tổng thể đúng (module-per-domain, `shared/` là single source of truth cho
Merkle/Poseidon), nhưng có ba tầng vấn đề tích tụ sau Phase 5:

1. **Trùng lặp có rủi ro đúng-sai.** Việc dựng lại `LURRecord` từ `receipt.json` bị
   chép tay ở 4 nơi. `CLAUDE.md` đã cảnh báo lệch ở đây _"would not throw, it would
   silently produce a leaf that is not in the tree"_ — nhưng chưa có test nào bảo vệ
   bất biến đó. `DeploymentRecord` có 3 bản và **đã lệch thật** (trường `deployedAt`).
2. **`government/` gánh 4 domain** — 3 controller + 5 service + 4 file DTO, trong đó
   820 dòng quy tắc pháp lý Việt Nam nằm chung folder với logic publish root.
3. **Không có ESLint/Prettier** cho backend lẫn blockchain (chỉ frontend có), nên
   style đã trôi: `constructor(…) { }` ở 6 file vs `{}` ở 9 file.

## Nguyên tắc thiết kế

- **API không đổi.** Mọi đường dẫn REST giữ nguyên tuyệt đối. Frontend và
  `PHASE_5_MANUAL_TEST.md` không phải sửa một dòng.
- **Barrel `shared/` phải browser-safe.** Code mới cần `fs`/`crypto` dùng lazy import
  theo đúng pattern `verifyGroth16Proof` đã có, để Phase 8/9 bundle được cho trình duyệt.
- **Không kéo thêm dependency vào `shared/`.** Cụ thể `keccak256(orgName)` cố ý ở lại
  phía caller vì đưa vào shared sẽ biến `ethers` thành dep của blockchain/shared.
- **Refactor không đổi hành vi.** 85 test Jest + 101 test Hardhat phải xanh y hệt sau
  từng commit.

## Quyết định

### D-R1 — `Receipt` là kiểu dùng chung, đặt tại `blockchain/shared/receipt.ts`

Bên ghi (backend `receipt.builder.ts`) và bên đọc (`verifyReceipt.ts`,
`transferSmoke.ts`, và Phase 9 browser verifier) phải dùng **cùng một kiểu**, nếu không
chúng trôi lệch mà vẫn compile. `buildReceipt()` ở lại backend vì nó cần Prisma
`Property`.

Hệ quả: cầu nối `area: number → .toFixed(2)` — quy tắc bắc cầu giữa định dạng wire
(number) và định dạng băm (chuỗi 2 chữ số thập phân) — về đúng **một** chỗ trong
`receiptOffchainMetadata()`.

Định dạng wire của `receipt.json` **không đổi** (D31/§3.1 đã chốt, và bundle đã phát
hành phải đọc được).

### D-R2 — Quy tắc chữ ký D34 thành code, không còn là comment

Hiện `issuer.service.ts` mô tả định dạng chữ ký trong docstring, còn `verifyReceipt.ts`
implement lại độc lập. `shared/issuerIdentity.ts` giữ `issuerSignatureMessage(address)`
làm nguồn duy nhất của "bytes nào được ký", để cả ba bên xác minh (backend, script,
trình duyệt Phase 9) không thể tính ra bytes khác nhau.

### D-R3 — `government/` thu gọn còn nghiệp vụ registry

Tách ra: `land-law/` (quy tắc pháp lý, không controller), `import/` (CSV → DB),
`transfers/` (trọn luồng D28). `api-key.guard.ts` lên `common/` vì cả
`GovernmentController` và `TransfersController` đều dùng.

`GovernmentController` **giữ nguyên toàn bộ route `/api/government/*`** kể cả
`POST /import` — nó là bề mặt API của cổng nhà nước, chỉ inject service từ module khác.
Đây là điều giữ cho ràng buộc "API không đổi" thành sự thật.

`GOV_API_KEY_SECURITY` chuyển về cạnh guard: `CLAUDE.md` yêu cầu `@ApiSecurity` phải
soi gương `@UseGuards`, đặt chung file thì dễ giữ đúng hơn.

### D-R4 — Trình tự commit tách format khỏi refactor

Prettier chạy toàn bộ đụng ~100 file. Trộn chung với dời folder thì không review được.
Do đó: config → format (thuần cơ học) → dedup → tách module → dọn rác → docs. Commit
format revert độc lập được.

## Bất biến cần được test bảo vệ

Bất biến mà 4 bản sao đang ngầm dựa vào nhưng chưa ai kiểm:

```
hashOffchainMetadata(toOffchainMetadata(property))
  === hashOffchainMetadata(receiptOffchainMetadata(buildReceipt({property, …}).record))
```

Thêm vào `metadata-integrity.spec.ts`.

**Ghi chú sau khi triển khai.** Sau khi gộp, `toOffchainMetadata` cũng gọi qua
`receiptOffchainMetadata`, nên nguy cơ "bên ghi và bên đọc bất đồng về danh sách trường
hay cách chuẩn hoá" đã bị loại bỏ **bằng kiến trúc** — kiểm chứng bằng cách đục
`.toFixed(2)` → `.toFixed(1)`: test vẫn xanh, vì cả hai vế dịch chuyển cùng nhau, và đó
là hành vi đúng.

Thứ test này thật sự canh là bất biến ở **mức giá trị**: `buildReceipt` ghi đúng giá trị
của row vào `record`. Kiểu dữ liệu không phủ được điều đó — thêm một override sau phần
spread vẫn type-check sạch. Kiểm chứng bằng cách chèn `area: Number(property.area) * 2`
vào `buildReceipt`: test đỏ đúng như mong đợi.

## Không làm

- **Layered architecture** (domain/application/infrastructure) — over-engineering cho
  PoC luận văn, và đi ngược convention module-per-domain mà NestJS lẫn repo đang theo.
- **Đổi định dạng `receipt.json`** — sẽ làm hỏng bundle đã phát hành.
- **Đụng frontend** — Phase 7+ chưa viết, sắp xếp bây giờ là đoán mò.
