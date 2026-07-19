# Audit toàn diện Phở Chat v1 — 2026-07-02

**Phạm vi:** Toàn bộ hoạt động production v1 (pho.chat). Nguồn dữ liệu: (1) git history + docs/audit từ 15/05, (2) Vercel runtime logs/error clusters 7 ngày, (3) PostHog project Phở Chat (error tracking, $ai_generation cost, event trends 30 ngày).
**Câu hỏi của founder:** Các vấn đề đã fix có triệt để chưa? Có tái phát không? Còn lỗ hổng gì về chi phí, cost LLM, authenticator kẹt?

---

## 1. Bức tranh tổng thể

**Điểm tốt:** Hệ thống chống-cháy-tiền (daily USD cap, tier gating, atomic slot) đang hoạt động đúng trên production — bằng chứng trực tiếp là ca larg.nguyen hôm nay bị chặn chính xác ở $5.32/$5.00. Cả 4 sự cố lớn tháng 6 (auth lockout, paid-user-hiển-thị-free, medical_beta burn, points không cấp lại) đều đã fix và **không thấy dấu hiệu tái phát** trên logs/PostHog.

**Điểm đáng lo (3 nhóm):**

1. **Tiền vào (thanh toán):** chuỗi webhook SePay/Polar/Clerk đều có vết nứt đang hoạt động — route SePay cũ chấp nhận webhook không chữ ký (giả mạo được), SePay miss orderId (29/06, đúng class gây ra vụ kích hoạt tay larg.nguyen), Polar mất log webhook do Neon timeout NGAY HÔM NAY trong lúc có khách checkout gói Perpetual 3.999.000đ, Clerk user.deleted kẹt retry loop.
2. **Tiền ra (LLM cost):** run-rate ~$13.8/ngày (~$415/tháng), 94% từ Claude Opus + Sonnet, trong khi chỉ có 3–8 người chat/ngày. Một user Pro nặng (199k/tháng ≈ $7.9) có thể đốt tới $15/ngày theo thiết kế cap hiện tại → lỗ ~15–50× trên user đó.
3. **Trải nghiệm bị chặn:** khách chạm cap không thấy lý do rõ → nhắn support (đã 2 case) — PHO-290 chưa làm.

---

## 2. Scorecard: các vấn đề đã fix — có tái phát không?

| # | Sự cố (khi nào) | Fix | Trạng thái 02/07 | Bằng chứng |
|---|---|---|---|---|
| 1 | **Auth lockout** — SW precache hỏng + middleware nuốt Clerk handshake (đầu 06) | `2c62519`, `e270596` (08–16/06) | ✅ Không tái phát | `auth_session_expired` ổn định ~12/ngày suốt 30 ngày, không spike; user đăng nhập & chat bình thường |
| 2 | **Paid user hiển thị như free** khi session hỏng (nga.ntv) | `6483a96`, `911dc66` (08/06) | ✅ Không tái phát | Không thấy case mới; logs hôm nay đều `Paid subscription validated` |
| 3 | **medical_beta burn $22/ngày** (root cause: model chưa seed giá, bill ~$0) | `271a83c` + caps (03–09/06) | ✅ Fix đúng root cause | USD cap giờ đọc được cost thật; DAILY CAP HIT hoạt động |
| 4 | **larg.nguyen kẹt cap Tier 2** (metadata medical_beta sót) | `58f8d66`, `ca75536` (20–22/06) | ✅ Không tái phát | Hôm nay plan resolve `vn_pro`, T2 unlimited message (audit riêng cùng ngày) |
| 5 | **Model chưa seed giá → leak 800×** | Seed 5 models (09/06) | ⚠️ **Tái phát biến thể mới** | `llama-3.3-70b-versatile` chưa seed → giờ tính ĐẮT oan ~10× ($0.113 vs $0.011); warning `NO DB pricing` đang bắn trong prod. Kèm `gemini-2.5-flash` lệch tier giữa gate (T2) và billing (T1) |
| 6 | **Billing sau stream bị drop** (Vercel freeze) | `after()` (08/06) | ⚠️ Còn sót khi Neon chập | 1 lần 29/06: `Failed to process model usage` do connection timeout → call đó không trừ tiền (fail-open) |
| 7 | **Monthly points không cấp cho plan trả phí** | Cron `grant-monthly-points` (01/06) | 🔍 Chưa verify được từ ngoài | Cần chạy `scripts/scan-drained-paid-users.ts` (dry-run) định kỳ để xác nhận |
| 8 | **Public API /api/v1/chat bypass mọi gating** | `4f17916` (03/06) | ✅ Enforcement chạy | Log `[Tier Check]`, cap blocks xuất hiện trên traffic |
| 9 | **Chat history rỗng sau login** (PHO-260) | `8af6d3f` (20/05) | ✅ Gần như hết | PostHog: 0–1 event/ngày (lác đác), không cluster |

**Kết luận scorecard:** 6/9 fix triệt để, 2 fix còn "đuôi" (leak biến thể mới #5, billing-drop khi DB chập #6), 1 chưa verify được (#7).

---

## 3. Lỗ hổng ĐANG MỞ (xếp theo rủi ro business)

### 🔴 P0 — rủi ro tiền trực tiếp

| Vấn đề | Ý nghĩa business | Bằng chứng | Giải pháp |
|---|---|---|---|
| **SePay compat route chấp nhận webhook không/sai chữ ký** (`src/app/api/sepay/webhook/route.ts:334-341` — "will still be processed for debugging") | Ai biết endpoint có thể GIẢ lệnh chuyển tiền để tự kích hoạt gói trả phí — mất doanh thu vô hình | Code hiện tại trên main; route mới (`/api/payment/sepay/webhook`) thì verify đúng | Tắt hẳn route cũ (nếu SePay đã trỏ route mới) hoặc bật enforce chữ ký. **0.5 ngày** |
| **Clerk `user.deleted` webhook lỗi constraint** (`global_files.creator` NOT NULL nhưng FK `ON DELETE SET NULL`) | User xoá tài khoản bị "kẹt nửa chừng": mất trên Clerk, còn nguyên data trong DB (rủi ro GDPR/niềm tin), Clerk retry vô hạn | 8 lỗi/3 users 29–30/06, sẽ bắn lại ở lần xoá kế | Sửa schema (nullable) hoặc xử lý global_files trước khi xoá user. **0.5 ngày** |

### 🟠 P1 — rủi ro doanh thu & khách trả phí

| Vấn đề | Ý nghĩa business | Bằng chứng | Giải pháp |
|---|---|---|---|
| **SePay miss orderId từ nội dung chuyển khoản** | Khách CHUYỂN TIỀN THẬT mà không được kích hoạt → lại phải kích hoạt tay như larg.nguyen (mỗi ca ~1 buổi support + uy tín) | 2 case, gần nhất 29/06: `❌ Could not extract orderId` | Nới regex parse + alert ngay khi fail (kèm nội dung CK) để xử lý trong phút thay vì đợi khách complain. **1 ngày** |
| **Polar webhook mất log do Neon timeout** | Mất audit trail thanh toán đúng lúc có khách checkout **Phở Assistant Perpetual 3.999.000đ hôm nay** (11:17 UTC); nếu timeout rơi vào event kích hoạt → lặp lại class "trả tiền không có gói" | 14 lỗi `WebhookLogger failed insert`/7 ngày, đang active | Ghi log webhook qua retry/queue (hoặc after()+retry 3 lần); alert khi activation event fail. **1 ngày** |
| **`pho-pro` (model thương hiệu) chạy Groq free-tier 12k TPM** | Khách TRẢ PHÍ chọn "Phở Pro" bị lỗi 413 khi hỏi dài — trải nghiệm tệ ở đúng model mang tên thương hiệu | Lỗi 413 `Request too large... TPM Limit 12000`, gần nhất 28/06 | Nâng Groq Dev Tier (~$?) hoặc route pho-pro sang provider khác. **0.5 ngày** |
| **Trang Discover/MCP lỗi 401 "Missing bearer token" từ 06/03** | ~340 lỗi/30+ users; trang public bị lỗi server → hại SEO + first impression | Cluster #2/#3/#5/#7, vẫn bắn hôm nay | Set/refresh env token registry MCP. **0.5 ngày** |
| **Thông báo chặn quota mơ hồ (PHO-290)** | Khách bị chặn không hiểu vì sao → ticket support (2 case đã ghi nhận); reason tiếng Việt "thử lại sau 0:00" ĐÃ có trong code, chỉ chưa surface | Ca larg.nguyen nhắn Zalo đúng lúc bị chặn | Map 5 loại block ra message riêng. **1 ngày, giảm ngay ticket** |

### 🟡 P2 — theo dõi / nợ kỹ thuật

- **Embedding/RAG chưa tính tiền** (P1-2 audit cũ, vẫn mở) — user KB nặng dùng embedding free.
- **Chat timeout 300s**: 45 lần/7 ngày/9 users — khách chờ 5 phút rồi mất câu trả lời (đã trừ tiền chưa? cần check per-case).
- **tool_use/tool_result corruption** (lịch sử chat gửi Anthropic bị lệch) — 16 lỗi, tập trung 1 user 29–30/06; bug reassembly lịch sử.
- **SyntaxError "Unterminated string in JSON"** (streaming plugin/chat) — ~60 lỗi rải rác, UX degradation.
- **tRPC UNAUTHORIZED chronic**: 509 lỗi/61 users/7 ngày, đều đặn từ tháng 2 — không phải regression spike, phần lớn là session hết hạn/anonymous gọi endpoint authed; cần chuẩn hoá client re-auth redirect thay vì retry.
- **PHO-267 cap overshoot** (~6–7%) — chấp nhận được, đã có backstop.
- **DB fail-open có chủ đích** ở `getDailyTierCostUSD` — chấp nhận 1 request lọt khi Neon chập; giữ nguyên nhưng cần alert nếu tần suất tăng.

---

## 4. Chi phí LLM & unit economics (PostHog, 15 ngày 18/06–02/07)

| Model | Cost 15 ngày | % tổng |
|---|---|---|
| anthropic/claude-opus-4.6 | **$101.62** | 49% |
| anthropic/claude-sonnet-4.6 | **$93.55** | 45% |
| google/gemini-2.5-pro | $9.70 | 5% |
| gemini-2.5-flash + còn lại | ~$2.5 | 1% |
| **Tổng** | **~$207** (≈$13.8/ngày, ~$415/tháng run-rate) | |

**Ý nghĩa business:**
- 94% chi phí đến từ 2 model đắt nhất, trong khi số người chat thực tế chỉ **3–8 user/ngày** → chi phí tập trung vào rất ít user nặng.
- Thiết kế cap hiện tại cho phép 1 user vn_pro đốt tối đa **$15/ngày** ($5×3 tier) = ~$450/tháng, gấp ~57× giá gói 199k. Ca thật hôm nay: larg.nguyen ~$10.7/ngày.
- Gói vn_premium (rẻ hơn) có USD cap = vn_pro ($5/5/5) — không còn inversion nhưng cũng không có phân tầng giá trị.

**Đề xuất (quyết định business, không phải code):**
1. Hạ cap Tier 3 (Opus) của vn_pro xuống $2–3/ngày; giữ Tier 2 $5. Tiết kiệm tức thì ~30–40% cost user nặng, đa số user không cảm nhận được.
2. Đẩy nhanh PHO-356 (%-of-cost meter, PRD đã có) — hiển thị "đã dùng X% hạn mức" như Claude.ai, khách tự điều tiết, đỡ shock khi bị chặn.
3. Routing thông minh: mặc định Sonnet, chỉ lên Opus khi user chọn chủ động.

---

## 5. Quy trình giám sát đề xuất (tận dụng PostHog vừa kết nối)

1. **Dashboard "Money Health"** (PostHog): LLM cost/ngày theo model · DAILY CAP HIT/ngày · webhook fail (SePay/Polar/Clerk) · auth_session_expired · `NO DB pricing` warnings.
2. **Alert 4 điều kiện** (PostHog alert / Vercel log drain): (a) SePay/Polar activation fail, (b) `NO DB pricing` model mới, (c) LLM cost ngày > $25, (d) `plan-drift` xuất hiện.
3. **Cron tuần:** `scan-drained-paid-users.ts --dry-run` + `audit-plan-drift.ts` → 5 phút đọc kết quả.
4. Mỗi fix production mới: ghi kèm "recurrence signal" (log string) vào ticket — audit lần sau chỉ cần grep.

---

## 6. Hành động 7 ngày tới (tóm tắt cho founder)

| Ưu tiên | Việc | Tác động | Công sức | Trạng thái |
|---|---|---|---|---|
| 1 | Tắt/harden SePay compat route | Bịt lỗ giả mạo thanh toán | 0.5d | ✅ **Fixed (PR này)** — enforce secret fail-closed, mirror route chuẩn |
| 2 | Fix Clerk user.deleted constraint | Hết user kẹt nửa-xoá | 0.5d | ✅ **Fixed (PR này)** — migration `0048` bỏ NOT NULL trên `global_files.creator` |
| 3 | Alert khi SePay/Polar activation fail + retry webhook log | Hết sự cố "trả tiền không có gói" âm thầm | 1d | ⏳ Chờ (cần thiết kế alert channel) |
| 4 | Seed llama-3.3 + đồng bộ tier gemini | Không tính oan tiền khách | 0.5d | ✅ **Seed llama-3.3 (PR này)** — cần chạy `bunx tsx scripts/seed-model-pricing-gateway.ts` trên prod. Gemini tier để founder quyết |
| 5 | PHO-290 message rõ ràng khi chạm cap | Giảm ticket support ngay | 1d | ⏳ Chờ |
| 6 | Fix bearer token Discover/MCP | Hết 500 trang public, đỡ hại SEO | 0.5d | ⏳ Chờ (cần env token registry) |
| 7 | Quyết định cap Opus + PHO-356 | Giảm 30–40% cost user nặng | quyết định + 1d | ⏳ Chờ quyết định business |

**Đã fix trong PR #77 (docs→code):** mục 1, 2, và phần seed của mục 4. Còn lại cần founder quyết (gemini tier, cap Opus) hoặc setup hạ tầng (alert, env token).

### ⚠️ Bước deploy thủ công sau khi merge

1. **Migration `0048`**: chạy migrate prod (hoặc `ALTER TABLE "global_files" ALTER COLUMN "creator" DROP NOT NULL;` trên Neon Console) để hết vòng lặp Clerk user.deleted.
2. **Seed giá llama-3.3**: `bunx tsx scripts/seed-model-pricing-gateway.ts` (hoặc chạy `scripts/seed-model-pricing-gateway.sql` trên Neon) để ngừng tính oan.
3. **SePay**: xác nhận SePay dashboard đang gửi `SEPAY_WEBHOOK_SECRET` (route chuẩn đã yêu cầu secret → nếu prod đang chạy tốt nghĩa là secret ĐÃ được gửi; route compat giờ cùng yêu cầu đó). Nếu SePay chỉ trỏ route compat và chưa gửi secret, phải cấu hình secret TRƯỚC khi deploy để tránh chặn webhook thật.
