# CLAUDE.md

This document serves as a shared guideline for all team members when using Claude Code in this repository.

## Tech Stack

read @.cursor/rules/project-introduce.mdc

## Directory Structure

read @.cursor/rules/project-structure.mdc

## Development

### Git Workflow

#### ⚠️ CRITICAL: Branch Strategy for pho.chat Production

**This is a solo-developer project. `main` is the single source of truth for production.**

**MANDATORY steps at the START of every session:**

```bash
git checkout main
git pull origin main # Always sync with latest main first
```

**Branch rules:**

- ✅ **ALWAYS start new features from the latest `main` branch**
- ✅ **When feature is complete: merge back into `main` and push**
- ✅ If you must create a feature branch, merge it back to `main` before ending the session
- ❌ **NEVER leave a feature branch unmerged** - unmerged branches cause incomplete production deployments
- ❌ **NEVER promote a Preview deployment to Production** without verifying it contains ALL features from `main`

**Why this matters:**

- Vercel deploys whatever branch you tell it to - a partial branch = partial production
- `main` must always contain 100% of all shipped features
- If you're unsure what's in `main`, run: `git log --oneline origin/main -10`

**Preferred workflow:**

```bash
# Start of session
git checkout main && git pull origin main

# Make changes directly on main (for small features)
# OR create branch + merge back immediately after
git checkout -b feat/my-feature
# ... do work ...
git checkout main
git merge feat/my-feature
git push origin main
```

#### QUAN TRỌNG: Visualizer Feature Branch

**KHÔNG BAO GIỜ push trực tiếp lên main.** Tất cả code mới commit vào branch hiện tại (`feat/visualizer`). Khi cần deploy staging, push lên origin branch hiện tại — Vercel sẽ tạo Preview deployment tự động.

#### Other Git Rules

- use rebase for git pull (when pulling into a feature branch)
- git commit message must prefix with gitmoji
- git branch name format: `claude/feature-description` or `feat/feature-name`
- use .github/PULL_REQUEST_TEMPLATE.md to generate pull request description

### Package Management

This repository adopts a monorepo structure.

- Use `pnpm` as the primary package manager for dependency management
- Use `bun` to run npm scripts
- Use `bunx` to run executable npm packages

### TypeScript Code Style Guide

see @.cursor/rules/typescript.mdc

### Modify Code Rules

- **Code Language**:
  - For files with existing Chinese comments: Continue using Chinese to maintain consistency
  - For new files or files without Chinese comments: MUST use American English.
    - eg: new react tsx file and new test file
- Conservative for existing code, modern approaches for new features

### Testing

Testing work follows the Rule-Aware Task Execution system above.

- **Required Rule**: `testing-guide/testing-guide.mdc`
- **Command**:
  - web: `bunx vitest run --silent='passed-only' '[file-path-pattern]'`
  - packages(eg: database): `cd packages/database && bunx vitest run --silent='passed-only' '[file-path-pattern]'`

**Important**:

- wrapped the file path in single quotes to avoid shell expansion
- Never run `bun run test` etc to run tests, this will run all tests and cost about 10mins
- If try to fix the same test twice, but still failed, stop and ask for help.

### Typecheck

- use `bun run type-check` to check type errors.

### i18n

- **Keys**: Add to `src/locales/default/namespace.ts`
- **Dev**: Translate `locales/zh-CN/namespace.json` locale file only for preview
- DON'T run `pnpm i18n`, let CI auto handle it

## Rules Index

Some useful rules of this project. Read them when needed.

**IMPORTANT**: All rule files referenced in this document are located in the `.cursor/rules/` directory. Throughout this document, rule files are referenced by their filename only for brevity.

### 📋 Complete Rule Files

**Core Development**

- `backend-architecture.mdc` - Three-layer architecture, data flow
- `react-component.mdc` - antd-style, Lobe UI usage
- `drizzle-schema-style-guide.mdc` - Schema naming, patterns
- `define-database-model.mdc` - Model templates, CRUD patterns
- `i18n.mdc` - Internationalization workflow

**State & UI**

- `zustand-slice-organization.mdc` - Store organization
- `zustand-action-patterns.mdc` - Action patterns
- `packages/react-layout-kit.mdc` - flex layout components usage

**Testing & Quality**

- `testing-guide/testing-guide.mdc` - Test strategy, mock patterns
- `code-review.mdc` - Review process and standards

**Desktop (Electron)**

- `desktop-feature-implementation.mdc` - Main/renderer process patterns
- `desktop-local-tools-implement.mdc` - Tool integration workflow
- `desktop-menu-configuration.mdc` - App menu, context menu, tray menu
- `desktop-window-management.mdc` - Window creation, state management, multi-window
- `desktop-controller-tests.mdc` - Controller unit testing guide

---

## Skills System — Mandatory for All Agents

All AI agents (Claude Code CLI, Antigravity, Cursor, Copilot, etc.) **MUST** use installed skills for specialized tasks. Skills are located in:

- `.claude/skills/` — Claude Code CLI skills (46 skills)
- `.agents/skills/` — Cross-agent skills (37 skills)
- `.agent/skills/` — Custom project skills

### Workflow: Task → Skill Lookup → Execute

1. **Before starting any specialized task**, check if a relevant skill exists
2. **Read the SKILL.md** first — follow its instructions exactly
3. **If no skill exists**, use one of:
   - `find-skills` skill — discover community skills via `npx skills search`
   - `skill-creator` skill — create a custom skill for the task
4. **After using a skill**, verify results match the skill's quality checklist

### Task-to-Skill Mapping

| Task Category       | Skills to Use                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| **UI/UX Design**    | `ui-ux-pro-max`, `frontend-design`, `canvas-design`, `theme-factory`          |
| **Debugging**       | `systematic-debugging`, `webapp-testing`                                      |
| **Testing**         | `test-driven-development`, `webapp-testing`, `verification-before-completion` |
| **Planning**        | `writing-plans`, `executing-plans`, `brainstorming`                           |
| **Code Review**     | `requesting-code-review`, `receiving-code-review`                             |
| **Database**        | `postgresql-table-design`, `sql-optimization-patterns`                        |
| **SEO/Marketing**   | `seo-audit`, `programmatic-seo`, `content-strategy`, `copywriting`            |
| **Documents**       | `docx`, `pdf`, `pptx`, `xlsx`, `doc-coauthoring`                              |
| **MCP Servers**     | `mcp-builder`                                                                 |
| **Next.js**         | `next-best-practices`, `vercel-react-best-practices`                          |
| **Parallel Work**   | `dispatching-parallel-agents`, `subagent-driven-development`                  |
| **API Integration** | `claude-api`, `ai-sdk`                                                        |
| **Git Workflow**    | `finishing-a-development-branch`, `using-git-worktrees`                       |

### Browser Testing with agent-browser

Use `agent-browser` CLI for web automation and UI testing:

```bash
agent-browser open <url>           # Navigate
agent-browser snapshot -i          # Get interactive elements with refs
agent-browser click @e1            # Click by ref
agent-browser fill @e2 "text"      # Fill by ref
agent-browser screenshot           # Capture screenshot
agent-browser close                # Close
```

### Creating Custom Skills

When no existing skill covers a domain, create one:

```bash
npx skills create my-skill-name # or use skill-creator skill
```

Place in `.claude/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`).

## Autoresearch Protocol

Khi được yêu cầu chạy autoresearch:

1. Đọc `.agents/skills/autoresearch/SKILL.md` cho full instructions
2. Đọc `auto/<topic>/autoresearch.md` trong project (session context)
3. Tạo branch `autoresearch/<topic>-<date>`
4. Chạy `node auto/<topic>/measure.mjs` để lấy baseline
5. Loop: brainstorm → implement → benchmark → checks → keep/revert → update docs
6. Mỗi run ghi vào `auto/autoresearch.jsonl`
7. Cập nhật `auto/<topic>/autoresearch.md` sau mỗi run (what worked, dead ends)
8. KHÔNG dừng trừ khi user interrupt hoặc 20 runs liên tiếp không cải thiện
9. Khi dừng: tạo summary trong autoresearch.md với top improvements

**Available topics:** `bundle` (bundle size optimization)

## Product Requirements Documents

PRD files nằm tại `docs/prd/`. Agent PHẢI đọc PRD trước khi implement bất kỳ feature nào
thuộc Interactive & Generative UI.

### Danh sách PRD

- `docs/prd/prd-interactive-generative-ui.md` — Tổng quan 5 phases + kiến trúc tích hợp
- `docs/prd/phase-2.5-content-visualizer.md` — Chi tiết 7-agent pipeline, schemas, file structure

### Implementation Priority

Bắt đầu từ Phase 1 (Interactive Images) trừ khi được chỉ định khác.
Đọc section "Implementation Priority" trong mỗi PRD để biết thứ tự triển khai.

### 5 Phases Overview

| Phase | Codename                                  | Timeline    |
| ----- | ----------------------------------------- | ----------- |
| 1     | Interactive Images (Tap-to-Explore)       | Month 1–2   |
| 2     | Generative Diagrams (Text-to-Interactive) | Month 3–4   |
| 2.5   | Content Visualizer (Paper-to-Visual)      | Month 4–5   |
| 3     | AI Rendering & Virtual Staging            | Month 5–7   |
| 4     | Full Generative UI Engine                 | Month 8–10  |
| 5     | Creator Studio & Collaboration            | Month 11–12 |

### Coding Conventions cho Interactive UI features

- Tất cả components mới đặt trong `src/components/InteractiveUI/` (Phase 1-2)
  hoặc `src/components/ContentVisualizer/` (Phase 2.5)
- Services đặt trong `src/services/content-visualizer/`
- Type definitions đặt trong `src/services/content-visualizer/types/`
- System prompts đặt trong `src/prompts/`
- Dùng Tailwind CSS only trong Artifact components (không custom CSS)
- Tất cả schemas phải match TypeScript interfaces trong PRD
- React functional components with hooks, single file, default export
- Dark theme (#0F172A family)
- Mobile responsive (touch support) + ARIA labels
- NEVER use localStorage/sessionStorage in Artifact components

## Linear Automation (always-on for this project)

Workspace cleanup baseline shipped 2026-05-20. Operating Manual lives at **PHO-260**
(pinned in Linear). When Claude works on a PR linked to a Linear ticket — title
contains `PHO-###` or branch matches `fix/pho-###-*` / `feat/pho-###-*` /
`claude/pho-###-*` — apply the automation rules below.

### After a PR is merged + production-verified

1. Use Linear MCP `save_issue` to set the corresponding ticket status to **Done**
   (state `Done`). If the work was a backfill — i.e. the ticket did not exist
   before merge — create the ticket directly in `Done` with title prefix
   `[Shipped]` and parent set to the relevant epic.
2. Use Linear MCP `save_comment` on the same ticket. Comment body must include:
   - PR URL (full GitHub link)
   - Verification summary: what was tested, where (production / staging),
     observed result
   - Production observations: relevant telemetry / log signals, user feedback
     if any
   - Cross-links to any child tickets created (see below)
3. NEVER auto-close parent epics (e.g. PHO-238). Epic closure is Hien's call.

### Creating follow-up tickets

- Use `save_issue` with `parentId` set to the parent epic's ID. Find the parent
  by searching (`list_issues query="..."`), never guess by number.
- Apply labels per the taxonomy defined in PHO-260 Operating Manual:
  - **Type** (exactly one): `bug`, `feature`, `tech-debt`, `docs`, `ops`,
    `research`
  - **Area** (multi-select): `billing`, `auth`, `ui`, `performance`, `model`,
    `payment`, `db`, `mcp`, `audit`, `security`, `observability`
  - **Modifier** (rare): `blocked`, `needs-discussion`
- Set priority using Linear's native field — `0` None, `1` Urgent, `2` High,
  `3` Medium, `4` Low. Do NOT create `P0/P1/P2/P3` labels.
- Land new tickets at the team's default state (currently `Backlog`) unless
  the prompt specifies otherwise. Triage state exists for issues coming from
  external integrations (GitHub Issues, Slack, customer Asks).
- Pre-flight check: before creating a "new" ticket, search for an existing
  ticket covering the same scope. The audit findings (`A1.x` references) in
  `docs/audit/audit-1-auth-2026-04-30.md` already have parented tickets
  (PHO-240, PHO-242, PHO-243, PHO-244, PHO-254) — comment on the existing one
  rather than creating a duplicate.

### Cross-linking adjacent tickets

When two tickets are semantically related (same audit finding, same root
cause, follow-up of follow-up), add a `save_comment` on the older ticket that
references the newer one, with a 1-paragraph note explaining the link and
whether scope overlaps.

### Language conventions

- Ticket titles and descriptions: **English**
- Comments on tickets whose original description is Vietnamese: keep Vietnamese
- Labels, initiatives, project names: **English** (per Operating Manual)
- Commit messages: **gitmoji prefix + English** (existing convention)

### Hard rules — never violate without Hien's explicit approval

- Don't delete issues. Only archive or set status to `Cancelled`.
- Don't change `assignee` on any issue. Hien is the owner of everything in
  workspace.
- Don't bulk-update more than **10 issues** in a single operation. For larger
  cleanup, post a plan first, wait for approval.
- Don't tag any **legacy labels** on new issues: `V1`, `V2`, `urgent`,
  `Math Vertical`, `growth`, `medical-plugin`, `UX`, `Improvement`, `infra`.
  These remain on historical issues for archeology but the new taxonomy
  supersedes them.
- Don't touch the `Duplicate` state — Linear manages it natively for
  duplicate-resolution flows.

### Stop conditions

Pause and surface to Hien when any of these happen:

- Linear MCP returns a rate-limit error → don't retry destructively
- Parent epic search returns multiple candidates → ask which one
- Free plan issue-cap approached (>240 non-archived) → flag before creating more
- A ticket exists with overlapping scope to the one Claude wants to create →
  ask whether to merge or proceed
- Any mutation error not covered by the rules above

### References

- **PHO-260** — Phở Chat Workspace Operating Manual (pinned in Linear)
- `docs/prompts/fix-chat-history-empty-PHO-260.md` — reusable bug-fix template
- `docs/prompts/linear-ai-workspace-cleanup.md` — periodic workspace cleanup
- `docs/prompts/claude-cli-linear-sync-PHO-260.md` — Linear sync workflow
- `docs/audit/audit-1-auth-2026-04-30.md` — V1 audit findings catalogue
