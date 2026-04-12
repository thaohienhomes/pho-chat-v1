# 🍜 Pho.Chat v1 — Round 2: Known Bugs Fix

> **Branch:** `fix/deep-research-rate-limit`
> **Linear Issues:** PHO-195, PHO-196, PHO-184, PHO-185, PHO-189
> **Prerequisite:** Branch `fix/posthog-audit-apr-2026` đã merge vào main.

---

## CRITICAL CONTEXT

**AI Model Architecture:**

- Pho.Chat gọi AI models qua **Vercel AI Gateway** (KHÔNG phải VertexAI trực tiếp)
- Provider string trong code: `vercelaigateway`
- Models available: `google/gemini-2.5-flash`, `google/gemini-2.5-pro`, `anthropic/claude-3.5-sonnet`, `kimi-k2.5`, etc.
- Rate limits là từ **Vercel AI Gateway**, không phải trực tiếp từ Google/Anthropic

**Codebase:** lobe-chat fork, Next.js App Router, tRPC, Clerk Auth, Zustand

---

## TASK 1 — \[P2/HIGH] Deep Research 429 Rate Limit (PHO-195)

### Problem

Deep Research chạy 4 AI agents **song song** (Clinical Researcher, Methodologist, Clinician, Patient Advocate), tất cả gọi `google/gemini-2.5-flash` qua Vercel AI Gateway → 429 Too Many Requests.

Console logs từ staging test:

```
[DeepResearch] callAI response: { length: 598, model: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }
[DeepResearch] callAI response: { length: 8004, model: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }
GET https://pho-chat-v1-git-fix-...vercel.app/api/... 429 (Too Many Requests)
[DeepResearch] Article attempt 1 failed: Bài viết chỉ có 1 từ (tối thiểu 200)
```

System tự retry → attempt 2 thành công → \~4000 từ. Nhưng UX rất chậm vì phải đợi retry.

### Investigation

```bash
# Tìm file chứa Deep Research agent orchestration
grep -r "Clinical Researcher\|Methodologist\|Clinician\|Patient Advocate" --include="*.ts" --include="*.tsx" -l

# Tìm nơi gọi callAI / parallel agents
grep -r "Promise.all\|Promise.allSettled\|callAI\|agents.*map" --include="*.ts" --include="*.tsx" -l

# Tìm Vercel AI Gateway config
grep -r "vercelaigateway\|ai-gateway\|gateway.*url\|VERCEL.*AI" --include="*.ts" --include="*.tsx" --include="*.env*" -l
```

### Fix: Concurrency Limiter + 429 Retry

**1. Tạo utility function cho rate-limited AI calls:**

```typescript
// src/utils/rateLimitedAI.ts (hoặc nơi phù hợp trong codebase)

const CONCURRENCY_LIMIT = 2;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

let activeRequests = 0;
const queue: (() => void)[] = [];

async function waitForSlot(): Promise<void> {
  if (activeRequests < CONCURRENCY_LIMIT) {
    activeRequests++;
    return;
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
}

export async function rateLimitedCallAI(
  callFn: () => Promise<any>,
  options?: { maxRetries?: number; label?: string },
): Promise<any> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;

  await waitForSlot();

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await callFn();
        return result;
      } catch (error: any) {
        const is429 =
          error?.status === 429 ||
          error?.message?.includes('429') ||
          error?.message?.includes('Too Many Requests');

        if (is429 && attempt < maxRetries) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 2s, 4s, 8s
          console.warn(
            `[RateLimiter] 429 on ${options?.label || 'AI call'}, ` +
              `retry ${attempt + 1}/${maxRetries} in ${delay}ms`,
          );

          // Track in PostHog
          if (typeof window !== 'undefined' && (window as any).posthog) {
            (window as any).posthog.capture('ai_rate_limit_429', {
              label: options?.label,
              attempt: attempt + 1,
              delay_ms: delay,
            });
          }

          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw error;
      }
    }
  } finally {
    releaseSlot();
  }
}
```

**2. Wrap agent calls trong Deep Research:**

Tìm nơi 4 agents được gọi (likely `Promise.all` hoặc `.map`) và thay thế:

```typescript
// BEFORE (4 agents song song, gây 429):
const results = await Promise.all([
  callAI(clinicalResearcherPrompt),
  callAI(methodologistPrompt),
  callAI(clinicianPrompt),
  callAI(patientAdvocatePrompt),
]);

// AFTER (concurrency limit 2 + retry):
import { rateLimitedCallAI } from '@/utils/rateLimitedAI';

const results = await Promise.all([
  rateLimitedCallAI(() => callAI(clinicalResearcherPrompt), { label: 'Clinical Researcher' }),
  rateLimitedCallAI(() => callAI(methodologistPrompt), { label: 'Methodologist' }),
  rateLimitedCallAI(() => callAI(clinicianPrompt), { label: 'Clinician' }),
  rateLimitedCallAI(() => callAI(patientAdvocatePrompt), { label: 'Patient Advocate' }),
]);
```

**3. Thêm delay giữa article generation và agent calls:**

```typescript
// After agents complete, before article generation:
await new Promise((r) => setTimeout(r, 2000)); // Cool-down 2s
const article = await rateLimitedCallAI(() => callAI(articleGenerationPrompt), {
  label: 'Article Generation',
  maxRetries: 3,
});
```

---

## TASK 2 — \[P2/HIGH] Assistant Chat Mode Search Loop (PHO-196)

### Problem

Khi dùng assistant "Chuyên gia tổng quan bài báo học thuật" trong chat mode thường (không phải Deep Research), model kimi-k2.5 chỉ output search descriptions ("Tôi sẽ tìm kiếm...") rồi dừng. Không viết bài.

### Investigation

```bash
# Tìm system prompt của assistant này
grep -r "Chuyên gia tổng quan\|academic.paper.overview\|academic-paper-overview" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" -l

# Tìm tool-calling config / max iterations
grep -r "maxIterations\|max_iterations\|tool_choice\|maxToolRoundtrips\|maxSteps" --include="*.ts" --include="*.tsx" -l

# Tìm max_tokens config per model
grep -r "max_tokens\|maxTokens\|maxOutputTokens" --include="*.ts" --include="*.tsx" -l
```

### Possible Fixes (depends on what investigation finds)

**Fix A: Nếu là tool-calling loop (model keep searching thay vì writing)**

```typescript
// Add maxSteps limit to prevent infinite search loop
// Wherever AI SDK streamText/generateText is called:
const result = await streamText({
  model: openai(selectedModel),
  messages,
  tools,
  maxSteps: 5, // Vercel AI SDK v4+ parameter — max 5 tool call rounds
  // OR nếu dùng older API:
  maxToolRoundtrips: 5,
});
```

**Fix B: Nếu là system prompt issue**
Thêm instruction vào system prompt:

```
QUAN TRỌNG: Sau khi tìm kiếm tài liệu (tối đa 3 lần tìm kiếm), bạn PHẢI tổng hợp kết quả và viết bài tổng quan hoàn chỉnh. Không được chỉ mô tả việc sẽ tìm kiếm mà không viết bài.
```

**Fix C: Nếu là max_tokens quá thấp**

```typescript
// Tăng max_tokens cho assistants viết bài dài
const maxTokens = isLongFormAssistant(assistantId) ? 8192 : 4096;
```

---

## TASK 3 — \[P3] File Upload Progress Indicator (PHO-184)

### Problem

File upload không có progress feedback, users retry 3-5x.

### Investigation

```bash
grep -r "upload\|fileUpload\|handleUpload\|uploadFile" --include="*.tsx" --include="*.ts" -l | head -20
```

### Fix

Tìm upload handler và thêm progress tracking:

```typescript
// Add progress state
const [uploadProgress, setUploadProgress] = useState<number>(0);
const [isUploading, setIsUploading] = useState(false);

// Use XMLHttpRequest for progress tracking (fetch doesn't support upload progress)
const uploadWithProgress = (file: File) => {
  setIsUploading(true);
  setUploadProgress(0);

  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      setUploadProgress(Math.round((e.loaded / e.total) * 100));
    }
  });
  xhr.addEventListener('load', () => {
    setIsUploading(false);
    setUploadProgress(100);
  });
  xhr.addEventListener('error', () => {
    setIsUploading(false);
    toast.error('Upload thất bại. Vui lòng thử lại.');
  });

  // ... send request
};

// In UI: show progress bar when uploading
{isUploading && (
  <div className="upload-progress">
    <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
    <span>{uploadProgress}% đang tải lên...</span>
  </div>
)}
```

---

## TASK 4 — \[P3] Export/Presentation Loading State (PHO-185)

### Problem

"Generate Presentation" button không có loading feedback, users rage-click.

### Investigation

```bash
grep -r "Generate.*Presentation\|export.*ppt\|generatePresentation\|presentation.*button" --include="*.tsx" --include="*.ts" -l
```

### Fix

Pattern giống Pay button (Task 4 từ round 1):

```typescript
const [isGenerating, setIsGenerating] = useState(false);

const handleGenerate = async () => {
  if (isGenerating) return;
  setIsGenerating(true);

  try {
    posthog?.capture('presentation_generation_started');
    await generatePresentation(/* ... */);
    posthog?.capture('presentation_generation_complete');
  } catch (error) {
    posthog?.capture('presentation_generation_failed', { error: error.message });
    toast.error('Tạo bài trình bày thất bại. Vui lòng thử lại.');
  } finally {
    setIsGenerating(false);
  }
};

<Button
  onClick={handleGenerate}
  disabled={isGenerating}
  loading={isGenerating}
>
  {isGenerating ? 'Đang tạo bài trình bày...' : 'Generate Presentation'}
</Button>
```

---

## TASK 5 — \[P3] Lexical Editor Link Edit Crash (PHO-189)

### Problem

`@lobehub/editor` LinkEdit component throws Lexical error #113 khi user click edit link button. Error #113 = "cannot access nodes outside read/update context."

### Investigation

```bash
# Check @lobehub/editor version
grep -r "@lobehub/editor" package.json

# Tìm nơi Lexical editor được sử dụng
grep -r "LexicalComposer\|LexicalEditor\|@lobehub/editor" --include="*.tsx" -l

# Check nếu có error boundary quanh editor
grep -r "ErrorBoundary.*editor\|editor.*ErrorBoundary" --include="*.tsx" -l
```

### Fix

Wrap editor trong error boundary để prevent crash:

```tsx
// Tìm component chứa Lexical editor và wrap:
import { ErrorBoundary } from 'react-error-boundary';

function EditorFallback({ resetErrorBoundary }) {
  return (
    <div className="editor-error">
      <p>Trình soạn thảo gặp lỗi.</p>
      <button onClick={resetErrorBoundary}>Tải lại</button>
    </div>
  );
}

// Wrap editor:
<ErrorBoundary FallbackComponent={EditorFallback} onReset={() => window.location.reload()}>
  <LexicalEditor {...props} />
</ErrorBoundary>;
```

Nếu `@lobehub/editor` có version mới, update:

```bash
npm ls @lobehub/editor     # Check current version
npm update @lobehub/editor # Update if newer version fixes this
```

---

## TASK 6 — \[BONUS] Fix Next/Image 400 Errors

### Problem

Console full of `Failed to load resource: the server responded with a status of 400` for `/next/image` URLs. Cosmetic but noisy — makes real errors hard to spot.

### Investigation

```bash
# Tìm nơi dùng next/image với external URLs
grep -r "next/image\|Image.*src=\|<img" --include="*.tsx" -l | head -20

# Check next.config.js image domains
grep -r "images.*domains\|images.*remotePatterns" next.config.ts
```

### Fix

Likely external image URLs (from search results) being passed to `next/image` without validation:

```typescript
// Add image URL validation before rendering
const isValidImageUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

// Fallback for invalid images
const SafeImage = ({ src, alt, ...props }) => {
  const [error, setError] = useState(false);

  if (!isValidImageUrl(src) || error) {
    return <div className="image-placeholder">{alt || 'Image'}</div>;
  }

  return <img src={src} alt={alt} onError={() => setError(true)} {...props} />;
};
```

Hoặc thêm domains vào `next.config.ts`:

```typescript
// next.config.ts
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**' }, // Allow all HTTPS images
  ],
},
```

---

## PRIORITY ORDER

1. **TASK 1** (PHO-195) — 429 rate limit → most impactful, fixes bsthuyanh89's Deep Research
2. **TASK 2** (PHO-196) — Chat mode search loop → fixes bsthuyanh89's assistant usage
3. **TASK 6** — Image 400 errors → reduces console noise, helps debugging
4. **TASK 5** (PHO-189) — Lexical crash → error boundary protection
5. **TASK 3** (PHO-184) — Upload progress → UX improvement
6. **TASK 4** (PHO-185) — Export loading → UX improvement

---

## VERIFICATION

- [ ] Deep Research: 4 agents complete without 429 (or retry silently)
- [ ] Deep Research: "Viết bài" generates ≥200 words on first attempt
- [ ] Chat mode: assistant writes full article after searching (not just search descriptions)
- [ ] Console: no more `/next/image` 400 errors
- [ ] Lexical editor: click link edit → no crash
- [ ] File upload: progress bar visible during upload
- [ ] Export: button shows loading state during generation

## GIT WORKFLOW

```bash
git checkout -b fix/deep-research-rate-limit
# Implement tasks
git add -A
git commit -m "fix: Deep Research 429 rate limit + assistant chat mode + UX improvements

- Add concurrency limiter (max 2 parallel AI calls) with 429 retry (PHO-195)
- Fix assistant chat mode search loop — add maxSteps + synthesis instruction (PHO-196)
- Add error boundary for Lexical editor (PHO-189)
- Add file upload progress indicator (PHO-184)
- Add export button loading state (PHO-185)
- Fix next/image 400 errors for external URLs

Linear: PHO-195, PHO-196, PHO-184, PHO-185, PHO-189"

# Test on staging first!
git push origin fix/deep-research-rate-limit
```
