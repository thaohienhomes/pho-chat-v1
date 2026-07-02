# Audit usage — larg.nguyen@gmail.com (vn_pro) — 2026-07-02

**Người dùng:** larg.nguyen@gmail.com · `user_39Y2ZW2HkbLsAOtm4w8FTVCnA3k` (chị Linh Nguyen)
**Gói:** `vn_pro` (Phở Đặc Biệt, 199.000đ/tháng) — kích hoạt thủ công 2026-06-20 do SePay webhook fail (commit `04d6c5b`), chu kỳ 30 ngày → hết hạn ~2026-07-20.
**Bối cảnh:** Chị hỏi lại (screenshot Zalo 19:00 ngày 02/07) về việc "Phở Pro vẫn giới hạn số lần sử dụng Tier 2" — từng có bug tier 2-3 hồi tháng 6.

## Kết luận nhanh (TL;DR)

1. **Bug cũ ĐÃ FIX, không tái phát.** Logs production hôm nay xác nhận plan resolve đúng `vn_pro`, Tier 2 không giới hạn số tin nhắn.
2. **Hôm nay chị bị chặn là do daily USD cost cap hoạt động ĐÚNG thiết kế**, không phải bug:
   - Tier 2: **$5.32 / $5.00** — chặn từ ~18:47 giờ VN
   - Tier 3: **$5.37 / $5.00** — chặn 19:33 giờ VN (thử gọi `claude-opus-4.6`)
   - Thời điểm chặn khớp chính xác tin nhắn 19:00 của chị.
3. **Câu chị hỏi ("Tier 2 không giới hạn tin nhắn nhưng có hạn mức token/ngày, hết thì đợi hôm sau?") — hiểu ĐÚNG.** Cap tính theo **chi phí USD/ngày/tier** (phụ thuộc token), reset **0:00 giờ VN**.
4. Chị là heavy user hợp lệ: chi phí provider ~**$10.7/ngày** (~$117 từ khi kích hoạt) so với giá gói ~$7.9/**tháng** → **chi phí ≈ 15× doanh thu**. Cần theo dõi unit economics (liên quan PHO-356).

## 1. Bug cũ (tháng 6) — trạng thái

| Sự kiện | Ngày | Commit |
| --- | --- | --- |
| Kích hoạt Pro thủ công (SePay webhook fail, 199k VND) | 20/06 14:36 | `04d6c5b` |
| **Bug:** script set `medical_beta: undefined` → JSON.stringify drop key → metadata `medical_beta` cũ còn nguyên → user bị áp cap Tier 2 = 30 msg/ngày của `medical_beta` thay vì unlimited của `vn_pro` | | |
| Fix: set `medical_beta: false` tường minh | 20/06 14:38 | `58f8d66` |
| Fix display + BillingLimit gợi ý model đúng tier (PHO-287) | 22/06 | `ca75536` |

**Verify trên production (02/07):** mọi request của user đều log `[Subscription Auth] ✅ Paid subscription validated`, `[Tier Check] ... Plan: vn_pro`, và **không có** dòng `Atomic Tier 2 Slot` nào (chỉ xuất hiện khi tier có message-limit hữu hạn) → Tier 2 đang unlimited message đúng như cấu hình `vn_pro` (`PLAN_MODEL_ACCESS.vn_pro.dailyLimits.tier2 = -1`).

## 2. Usage thực tế hôm nay (02/07, log Vercel production)

Nguồn: runtime logs project `pho-chat-v1`, deployment `dpl_E4W8xe99...` (branch main), cửa sổ 00:00–19:33 giờ VN (log bị phân trang, số liệu cap là số server tự báo — authoritative).

- **Model chính:** `anthropic/claude-sonnet-4.6` (Tier 2) — 32+ calls ghi nhận được trong ~6,5h, tổng ~$4.69 (riêng phần log lấy được).
- **Kích thước request:** trung bình ~20k input tokens/call (max 42k), ~5k output tokens (max 32k), có call stream 4 phút → đúng pattern "phân tích tổng hợp báo cáo phòng khám" chị nói ngày 23/06.
- **Tier 3:** đã tiêu $5.37 trước 19:33 (các call Opus buổi sáng/trưa nằm ngoài cửa sổ log lấy được).
- **Chặn 429:** 5 request bị `DAILY_CAP_EXCEEDED` trong 18:52–19:33 giờ VN (4 lần Tier 2, 1 lần Tier 3).
- **Phở Points:** còn **1.988.267 / 2.000.000** — đã dùng ~11.7k điểm (~$117 chi phí thật) từ 20/06. Points KHÔNG phải điểm nghẽn; điểm nghẽn duy nhất là daily USD cap.
- **Tier 1** (`gemini-2.5-flash`, `llama-3.3-70b`): dùng rất ít, ~$0.12.

### Các lớp giới hạn đang áp lên vn_pro (để trả lời support cho chuẩn)

| Lớp | Giá trị vn_pro | Reset | Trạng thái của chị hôm nay |
| --- | --- | --- | --- |
| Số tin nhắn Tier 2/ngày | Không giới hạn (-1) | — | OK |
| Số tin nhắn Tier 3/ngày | 50 | 0:00 VN | Chưa chạm (bị chặn bởi cap USD trước) |
| **Daily USD cap / tier** | **$5/tier/ngày** (`dailyCostCaps.ts`) | **0:00 VN** | **T2 $5.32 ❌ · T3 $5.37 ❌** |
| Tổng request/ngày (circuit breaker) | 500 | 0:00 VN | Chưa chạm |
| Phở Points tháng | 2.000.000 | Cuối tháng | Còn 99.4% |

## 3. Trả lời đề xuất cho chị Linh

> Chị hiểu đúng rồi ạ. Gói Pro **không giới hạn số tin nhắn** với model Tier 2, nhưng mỗi tier có **hạn mức chi phí sử dụng mỗi ngày** (tính theo token — tài liệu dài, phân tích nhiều thì tốn nhanh hơn). Khi chạm hạn mức trong ngày, hệ thống tạm khóa tier đó và **tự mở lại lúc 0:00 giờ VN** — hoặc chị chuyển sang model tier thấp hơn (vd Gemini Flash) để dùng tiếp ngay. Hôm nay chị chạy phân tích tài liệu khá nặng nên chạm mức của cả Tier 2 và Tier 3 vào buổi tối ạ.

Gợi ý thêm cho founder: nếu chị cần workload phân tích lớn thường xuyên, có thể (a) nâng `vn_ultimate` (cap $10/tier/ngày), hoặc (b) cân nhắc cap riêng cho user này qua env override `DAILY_CAP_VN_PRO_T2` (ảnh hưởng toàn plan — không khuyến nghị chỉ vì 1 user).

## 4. Findings phụ phát hiện trong lúc audit

| # | Mức | Vấn đề | Đề xuất |
| --- | --- | --- | --- |
| F1 | MED | `llama-3.3-70b-versatile` chưa được seed vào `model_pricing` → bill theo fallback conservative (31250/250000 pts/1M) = **$0.1133** cho call thực tế chỉ ~$0.011 (**đắt ~10×**), trừ oan vào tier-1 cap + points của user | Thêm vào `scripts/seed-model-pricing-gateway.ts` và re-seed (log server đã tự nhắc đúng việc này) |
| F2 | LOW | `gemini-2.5-flash` **lệch tier giữa gate và billing**: `MODEL_TIERS` (pricing.ts) xếp Tier 2 → gate check đọc bucket tier-2, nhưng `model_pricing` DB seed tier **1** → cost ghi vào bucket tier-1. Meter lệch: spend Gemini không bao giờ tính vào cap Tier 2 | Đồng bộ tier trong seed script với `MODEL_TIERS` (chọn 1 nguồn chân lý) |
| F3 | LOW (đã biết) | Cap có thể vượt nhẹ ($5.32, $5.37 > $5.00) vì cap check là pre-flight còn cost ghi sau khi stream xong — đúng mô tả PHO-267 (backlog) | Chấp nhận best-effort (đã có budget backstop) hoặc làm atomic theo PHO-267 |
| F4 | MED (UX) | User bị chặn nhưng vẫn nhắn hỏi support → thông báo lỗi trên UI nhiều khả năng chưa truyền tải reason tiếng Việt của `checkDailyCostCap` ("thử lại sau 0:00") — trùng scope **PHO-290** (5 loại block map chung 1 message mơ hồ) | Ưu tiên PHO-290; reason string đã có sẵn, chỉ cần surface đúng |
| F5 | INFO | Unit economics: user này cost ~$10.7/ngày vs doanh thu ~$7.9/tháng. Với 2 tier maxed mỗi ngày, trần lỗ ~$15/ngày/user Pro | Theo dõi qua runbook free-premium-burn (PHO-356); cân nhắc giảm `monthlyPoints` hoặc cap tổng |

## 5. Phạm vi & giới hạn của audit

- Sandbox không có `DATABASE_URL`/`CLERK_SECRET_KEY` → không query trực tiếp `usage_logs`/Clerk; số liệu lấy từ Vercel runtime logs production (14h gần nhất + cửa sổ sáng 02/07, bị phân trang 100 entries/query).
- Số cap-used ($5.32/$5.37) là số **server tự tính từ `usage_logs`** in ra log — đáng tin hơn tổng cộng thủ công từ log bị phân trang.
- Muốn số liệu đầy đủ theo ngày/tháng: chạy `bunx tsx scripts/find-db-user.ts larg.nguyen@gmail.com` + query `usage_logs` theo `userId` trên Neon, hoặc GET `/api/admin/rate-limits/user_39Y2ZW2HkbLsAOtm4w8FTVCnA3k`.
