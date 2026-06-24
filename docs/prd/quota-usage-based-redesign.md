# PRD — Quota theo % usage (token/cost-based), thay cho "số tin nhắn/ngày"

> Status: **Proposal (chờ Hien duyệt)** · Author: Claude · Date: 2026-06-24
> Trigger: audit user `larg.nguyen@gmail.com` (PHO-238 cost-cap family)

## 1. Vì sao cần đổi

### 1.1 Triệu chứng (từ audit thực tế)

User `larg.nguyen@gmail.com` (`user_39Y2_8FTVCnA3k`) nâng lên `vn_pro`, gặp lỗi
*"🌙 Bạn đã dùng hết hạn mức hôm nay"* (Tier 2). Audit cho thấy:

- User **đúng gói `vn_pro`** (telemetry `planId=vn_pro`), **không** phải bug drift.
- User là **power-user**: ~$8–10 tiền model/ngày (T2 ~$5.4, T3 ~$5.8 các ngày đỉnh),
  trong khi `vn_pro` chỉ ~$6.5–7.8/tháng doanh thu → **lỗ ~35–40x**.
- Lỗi user thấy = **trần chi phí USD/tier/ngày** (`dailyCostCaps.ts`) đang hoạt động
  đúng thiết kế, KHÔNG phải do "siết cap nhầm".

### 1.2 Vấn đề gốc: đang dùng 2 đơn vị đo quota, cả 2 đều lệch

Hệ thống hiện enforce song song **hai lớp khác đơn vị**:

| Lớp | Đơn vị | Khai báo ở | Enforce ở |
|---|---|---|---|
| (A) Message-count | "X tin/ngày" theo tier | `pricing.ts` `dailyTier2Limit` / `dailyTier3Limit` | `atomicAcquireTierSlot()` (`credits.ts`) |
| (B) USD cost cap | "$Y/tier/ngày" | `dailyCostCaps.ts` `PLAN_CAPS` | `checkDailyCostCap()` (chat route) |

**Lớp (A) — đếm tin nhắn — sai về bản chất** (đúng như anh nói):
mỗi tin có context khác nhau. 1 tin hỏi PDF 200k token và 1 tin "hi" đều tính là
**1 tin**. Quy ra: user context dài bị cắt "oan", user context ngắn được hời. Đây
chính là lý do Claude và Gemini đã bỏ đếm tin → chuyển sang **% usage theo compute**.

**Lớp (B) — USD cap — đúng bản chất (usage-based) nhưng đang ẩn**:
nó đo chi phí thực (`usage_logs.cost_usd`), nhưng (i) hiển thị cho user dạng mơ hồ
"hết hạn mức" không có %, (ii) là trần cứng per-tier-per-day, (iii) UI cố tình giấu
số tiền (chỉ thị của Hien 2026-05-03 trong `BillingLimit.tsx`).

**Hệ quả — quota quảng cáo ≠ quota thực thi:** `pricing.ts` quảng cáo `vn_pro` =
"Unlim Tier 2", nhưng lớp (B) cắt ở $5 T2/ngày. User "unlimited" vẫn bị chặn →
khiếu nại. Đây là mâu thuẫn cấu trúc, không sửa được bằng cách nâng cap.

## 2. Mục tiêu

1. **Một đơn vị quota duy nhất** = compute thực tế (token-cost), bỏ đếm tin nhắn.
2. **Hiển thị dạng %** kèm thời điểm reset — giống Claude/Gemini.
3. **Quota quảng cáo == quota thực thi** (hết mâu thuẫn unlimited-nhưng-bị-chặn).
4. **Gắn budget với đơn vị kinh tế** để không lỗ 35–40x như case trên.
5. Không phá vỡ tier-access (gói nào được chạm model tier nào vẫn giữ).

## 3. Thiết kế đề xuất

### 3.1 Đơn vị: "Compute Units" (CU) — quy từ token-cost đã có sẵn

Hệ thống **đã tính** `usage_logs.cost_usd` cho mọi request (chat route lines
~805–835). Không cần hạ tầng mới — chỉ cần coi nó là **đồng hồ đo duy nhất**.

- Nội bộ: giữ USD (hoặc Phở Points, 1 point = $0.01) làm ground-truth.
- User-facing: quy ra **%** của budget gói → không lộ giá vốn, dễ hiểu.
- Mỗi model có "tốc độ đốt" khác nhau (T3 đốt nhanh hơn T2 ~10x). Hiển thị
  "cost weight" tương đối để user tự học (Claude làm vậy với Opus).

### 3.2 Cửa sổ thời gian: tuần + sub-cap ngày (khuyến nghị, kiểu Claude)

| Phương án | Mô tả | Đánh giá |
|---|---|---|
| A. Daily duy nhất | 1 budget/ngày/gói (gộp các tier), show % | Đổi tối thiểu, nhưng vẫn cắt user vào ngày research nặng |
| **B. Weekly + daily safety (khuyến nghị)** | Budget chính theo **tuần**, kèm sub-cap ngày chống blow-out 1 ngày | Mượt spike, giống Claude "weekly limits", ít khiếu nại nhất |

### 3.3 Budget gắn với unit economics (đây mới là đòn bẩy thật)

Trần hiện tại `vn_pro` = $5×3 tier = **tối đa $15/ngày ≈ $450/tháng** giá vốn,
trên doanh thu ~$7/tháng → kể cả "đúng thiết kế" vẫn cho phép lỗ tới ~60x.
Budget mới phải đặt theo **% COGS mục tiêu trên doanh thu**:

| Gói | Doanh thu/tháng | COGS mục tiêu (vd 50%) | Budget compute/tháng | Ghi chú |
|---|---|---|---|---|
| vn_free | $0 | — | ~$0.5–1 (chặn lỗ) | T1 only |
| vn_basic | ~$2 | ~$1 | ~$1/tháng | |
| vn_premium | ~$5 | ~$2.5 | ~$2.5/tháng | |
| **vn_pro** | ~$7 | ~$3.5 | **~$3.5/tháng** | hiện cho phép gấp ~100x |
| vn_ultimate | ~$20 | ~$10 | ~$10/tháng | hướng upsell power-user |
| vn_team | pooled | theo seats | theo seats | |

> Con số trên là **khung để Hien chốt**, không phải giá trị cuối. Điểm mấu chốt:
> budget phải tính ngược từ doanh thu, không đặt cảm tính. Power-user như
> `larg.nguyen` sẽ chạm budget sớm → đúng tín hiệu để **upsell lên Ultimate**,
> không phải để cho thêm free.

### 3.4 Enforcement

- Thay 2 lớp (A)+(B) bằng **1 check budget** đọc cùng nguồn `usage_logs` (đã có
  `getDailyTierCostUSD` trong `dailyCostAggregation.ts`; mở rộng thành
  `getUsageInWindow(userId, window)`).
- Giữ **tier-access** (`allowedTiers` / `PLAN_MODEL_ACCESS`) — gói nào chạm tier nào.
- Bỏ vai trò enforce của `dailyTier2Limit`/`dailyTier3Limit` (giữ field cho
  backward-compat, đánh dấu deprecated).
- Giữ **env override** `DAILY_CAP_*` cho điều chỉnh nóng; bổ sung tương tự cho
  window mới.

### 3.5 Per-user override (giải quyết "nâng cap cho 1 khách")

Hiện **không** nâng cap riêng 1 user được — `getDailyCostCap()` chỉ đọc env theo
**gói**, đổi là đổi cho cả tier. Thiết kế mới thêm `users.compute_budget_override`
(nullable): nếu set thì dùng giá trị này thay budget gói. Cho phép goodwill có
kiểm soát, không đụng cả tier.

### 3.6 UX (tái dùng UI có sẵn)

- `TierUsageDisplay.tsx` đã render `Progress` theo %. Chỉ đổi nguồn dữ liệu từ
  `count/limit` → `usedCU/budgetCU`.
- `usage-stats` API trả thêm `computeUsedPct`, `windowResetAt`, `budgetCU`.
- Mốc 80%/100%: cảnh báo mềm + gợi ý đổi model (đã có trong `BillingLimit.tsx`).
- Copy: *"Bạn đã dùng 72% hạn mức tuần này — reset Thứ Hai."*

## 4. Rollout (an toàn, đo trước khi cắt)

1. **Shadow mode**: tính %/budget nhưng **không enforce**; log qua telemetry.
   (Đã bật được nhờ fix `plan_source` hôm nay — xem §6.)
2. **Tune**: xem phân phối thực `cost_usd` theo gói trong PostHog, chốt budget §3.3.
3. **Soft launch**: hiện meter % cho user, vẫn để cap cũ enforce.
4. **Flip**: chuyển enforce sang budget; deprecate đếm tin nhắn.
5. Cập nhật `pricing.ts` `keyLimits` để quảng cáo khớp thực thi.

## 5. Files chạm tới (ước lượng)

| File | Thay đổi |
|---|---|
| `src/config/pricing.ts` | Thêm `computeBudget` per plan; deprecate `dailyTierNLimit` |
| `src/server/services/billing/dailyCostCaps.ts` | Tổng quát hoá thành budget theo window + per-user override |
| `src/server/services/billing/dailyCostAggregation.ts` | `getUsageInWindow()` (daily→weekly) |
| `src/app/(backend)/webapi/chat/[provider]/route.ts` | Thay 2 lớp check bằng 1 budget check |
| `src/server/services/billing/credits.ts` | Gỡ vai trò enforce của message-count |
| `packages/database/.../users` | `compute_budget_override` (nullable) |
| `src/app/api/subscription/usage-stats/route.ts` | Trả `computeUsedPct`, `windowResetAt` |
| `src/features/UsageMeter/TierUsageDisplay.tsx` + `hooks/useUsageStats.ts` | Đổi nguồn → % compute |

## 6. Đã làm trong audit này (enabler)

Fix **`plan_source` telemetry** (PHO-246) — điều kiện cần cho shadow-mode §4.1 và
để audit drift DB↔Clerk tự động sau này:

- `src/libs/posthog-server.ts` đã có sẵn param `planSource` → emit `plan_source`.
- Trước đây chat route gọi `getUserPlanIdFromDB()` (chỉ trả string) nên
  `plan_source` luôn = null trong PostHog.
- Đã đổi sang `getUserPlanFromDB()` (trả cả `.source`) và forward `planSource`
  qua `processModelUsage()` → `captureAiGeneration()`.
- Files: `route.ts`, `credits.ts` (`UsageLogParams.planSource`).

## 7. Quyết định cần Hien chốt

1. Cửa sổ: **Weekly + daily safety (B)** hay Daily (A)?
2. COGS mục tiêu (% doanh thu) để khoá budget §3.3 — đề xuất ~50%.
3. Có làm `compute_budget_override` per-user ngay đợt này không?
4. Có tạo Linear ticket dưới epic PHO-238 để track không?
