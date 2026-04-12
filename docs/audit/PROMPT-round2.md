Đọc file /docs/claude-code-prompt-round2-fixes.md (hoặc nếu không có thì dùng context bên dưới).

Tạo branch fix/deep-research-rate-limit từ main.

## CRITICAL CONTEXT

- AI models được gọi qua **Vercel AI Gateway** (provider: `vercelaigateway`), KHÔNG phải trực tiếp qua VertexAI/Google
- Lỗi 429 Too Many Requests đến từ Vercel AI Gateway khi quá nhiều parallel calls
- Codebase là lobe-chat fork, Next.js App Router

## 6 TASKS — theo thứ tự priority

### TASK 1 \[P2] — PHO-195: Deep Research 429 Rate Limit

Deep Research chạy 4 AI agents song song (Clinical Researcher, Methodologist, Clinician, Patient Advocate), tất cả gọi google/gemini-2.5-flash qua vercelaigateway → 429 Too Many Requests.
FIX: Tạo concurrency limiter (max 2 parallel AI calls) + exponential backoff retry khi gặp 429 (2s, 4s, 8s, max 3 retries). Wrap tất cả agent calls trong Deep Research qua limiter này. Thêm 2s cool-down delay trước article generation step. Track 429 events trong PostHog: posthog.capture('ai_rate_limit_429', { label, attempt, delay_ms }).

### TASK 2 \[P2] — PHO-196: Chat Mode Search Loop

Assistant "Chuyên gia tổng quan bài báo học thuật" trong chat mode thường (không phải Deep Research) chỉ output "Tôi sẽ tìm kiếm..." rồi dừng — model liên tục gọi search tool mà không bao giờ synthesize thành bài viết.
FIX: Tìm nơi streamText/generateText được gọi cho assistant chat → thêm maxSteps: 5 (hoặc maxToolRoundtrips: 5) để giới hạn số lần gọi tool. Nếu có thể, thêm instruction vào system prompt: "Sau tối đa 3 lần tìm kiếm, PHẢI tổng hợp kết quả thành bài viết hoàn chỉnh."

### TASK 3 \[P3] — PHO-189: Lexical Editor Crash

@lobehub/editor LinkEdit component throws Lexical error #113 khi click edit link.
FIX: Wrap Lexical editor component trong React ErrorBoundary với fallback UI "Trình soạn thảo gặp lỗi" + reload button. Kiểm tra nếu @lobehub/editor có version mới thì update.

### TASK 4 \[P3] — PHO-184: File Upload Progress

File upload không có progress indicator, users retry 3-5x.
FIX: Tìm upload handler → thêm progress state + progress bar UI hiển thị % upload. Disable upload button khi đang upload.

### TASK 5 \[P3] — PHO-185: Export Button Loading

"Generate Presentation" button không có loading feedback.
FIX: Thêm isGenerating state + disabled + loading spinner khi click, giống pattern Pay button đã fix trong round 1.

### TASK 6 \[BONUS] — Fix Next/Image 400 Errors

Console đầy lỗi "Failed to load resource: status 400" cho /next/image URLs từ search results.
FIX: Thêm onError fallback cho external images + validate URL trước khi render. Hoặc thêm remotePatterns: \[{ protocol: 'https', hostname: '\*\*' }] vào next.config.ts images config.

## RULES

- Test từng task sau khi implement — chạy type check
- KHÔNG push trực tiếp vào main — push branch fix/deep-research-rate-limit
- Commit message format: "fix: \[description] (PHO-XXX)"
- Deploy staging trước khi merge
