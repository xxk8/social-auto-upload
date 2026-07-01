# Vitest 测试套件 · Vitest Suite Layout

> Web Shell 运营台 + 公共组件库 · `sau_web/frontend/src` 下的 vitest 套件结构与约定。
> Routes-by-component-by-flow 三层分工，方便 PR 评审一眼看清每条不变式落在哪一层。

---

## 1. 三层结构 (Three Tiers)

vitest 与 Playwright e2e 共存，按"行为层级 + 工具依赖"分三层。核心原则：

- **vitest ≠ Playwright**：vitest 在 happy-dom + jsdom 环境中跑 RTL 断言（ms 级），不启 Vite；e2e 用 chromium 启完整 SPA（s 级）。把能用 vitest 表的不变式搬到 vitest，e2e 只留 chromium-only 的部分（锚链接、cookie 行为、console 排错等）。
- **三层的契约边界**：

| 层 (Tier) | 工具 | 跑速 | 不变式类型 | 失败定位 |
|---|---|---|---|---|
| Routing | vitest + RTL | <100 ms / spec | URL → 组件 ↔ Navigate 的映射 | 通过 mockUseAuth 驱动 authStore |
| Component | vitest + RTL | <1 s / spec | 单组件状态机 + 子组件装配契约 | 通过 vi.mock + within() 隔离子树 |
| Flow (chromium-only) | Playwright | ~10-30 s / spec | 跨页跳转 + 浏览器副作用 | chromium console + page error |

---

## 2. 当前快照 (Current Snapshot)

> 来源：`/tmp/vitest-suite.txt` (`pnpm exec vitest run --reporter=verbose`)。

**Total: 18 test files · 439 tests · 413 pass · 26 fail（pre-existing，未在本轮 work 内）**
> 增量：this round（OPT-3F+）新加 `src/Pages/InboxPage.test.tsx`（59 tests / 59 pass / 0 fail）进 §5.1 CI vitest gate；详见 §4.5 concurrent-download chip contract。

### 2.1 Tier-1 · Routing（6 tests）

URL → 组件映射，`AuthGuard` 包裹下的 redirect 行为。

| File | Tests | Pass | Fail | 覆盖 |
|---|---:|---:|---:|---|
| `src/App.test.tsx` | 17 | 17 | 0 | `MemoryRouter` 镜像 `App.tsx` 全 Routes 表（marketing 5 + login 1 + legacy-shim 6 + direct /app/* 5 + 404 2，详见文件 docblock） |
| `src/features/auth/LoginPage.test.tsx` | 5 | 5 | 0 | LoginPage 的"已登录 → `/app/publish`"与"匿名 → 表单"两条分支，借助 `redirect-spy.tsx` + `mockUseAuth` 驱动 |

### 2.2 Tier-2 · Component（10 files）

单组件 + 子组件装配 + 状态机不变式。

| File | Tests | Pass | Fail | 覆盖 |
|---|---:|---:|---:|---|
| `src/Pages/AccountsPage.test.tsx` | 8 | 8 | 0 | PageHeader chrome + AuthGuard 匿名 bounce + BodyArea 三分支（loading / empty / search-filtered）+ 头部 action 通过 `within(page-header-actions).getByRole` 锁定 PageHeader 自己 |
| `src/Pages/PublishPage.test.tsx` | 10 | 10 | 0 | PageHeader + Tabs + 桌面 PublishAiSidebar + 移动 AI trigger + mobile drawer 开/闭 (`within(mobile-ai-drawer)` 锁定抽屉内的 sidebar) |
| `src/Components/AiPanel/AiPanel.test.tsx` | 29 | 29 | 0 | 折叠/展开状态机 + children 始终挂载 + drag-handle |
| `src/Components/AiPanel/AiPanelToolbar.test.tsx` | 23 | 18 | **5** | 渲染、key count、quick-generate、移动 viewport (375 px) — 5 失败：模型名 + key-count 的文本匹配需要 `within()` 收窄，见 §4.2 |
| `src/Components/AiPanel/ChatArea.test.tsx` | 11 | 7 | **4** | 空态、消息渲染、streaming draft、错误块 — 4 失败：react-markdown 10.x 移除了 `<Markdown className=...>` 形态，需迁到 `components={{ p: ... }}` 形式 |
| `src/features/accounts/AccountsProvider.test.tsx` | 27 | 27 | 0 | Provider state machine + dispatch surface + filter logic + `getPlatformLabel` |
| `src/features/publish/NoteForm.test.tsx` | 7 | 1 | **6** | imperative handle (applyAiResult) + React.memo 稳定性 — 6 失败：表 `@/Components/ui/index` 的 `vi.mock` 工厂缺少 `AlertDialog` 导出，需补齐 |
| `src/features/publish/VideoForm.test.tsx` | 9 | 1 | **8** | 同 NoteForm，imperative handle + memo 稳定性 — 8 失败：同 `AlertDialog` mock gap |
| `src/features/tasks/TaskDrawer.test.tsx` | 10 | 8 | **2** | drawer prop surface + React.memo + 运行日志 accordion — 2 失败：memo HIT 计数跳变（React 19 strict-mode 双 render）+ accordion 触发器查询 |
| `src/features/tasks/TaskTableRow.test.tsx` | 12 | 11 | **1** | 行渲染 + 回调稳定性 + memo HIT — 1 失败：同 memo HIT 计数跳变 |
| `src/Pages/InboxPage.test.tsx` | 59 | 59 | 0 | `/app/inbox` 路由表 + AuthGuard + PageHeader chrome + Concurrent-downloads chip contract（4 条 lock test — 详见 §4.5） |

### 2.3 Tier-2 (lib, stores) · Pure logic（5 files）

无组件渲染，纯逻辑 / store / hook 测试。

| File | Tests | Pass | Fail | 覆盖 |
|---|---:|---:|---:|---|
| `src/lib/tone.test.ts` | 130 | 130 | 0 | 3 段 / 4 段 / 2 段 tone 映射 + FP-drift boundary + class-string map + 概念锁 |
| `src/lib/chat/pruner.test.ts` | 13 | 13 | 0 | TTL/quota 两阶段剪枝 + 默认 policy |
| `src/lib/chat/useChatFormBridge.test.ts` | 19 | 19 | 0 | form snapshot enter / apply / payload 组装（含 mounted / unmounted degradation） |
| `src/lib/chat/useChatActions.test.tsx` | 16 | 16 | 0 | chat actions 钩子契约 |
| `src/stores/useChatStore.test.tsx` | 34 | 34 | 0 | session 集合 + cancel/markApplied/setJobStatus/hydrate/reset |

### 2.4 Tier-3 · Flow (chromium-only, e2e)

不在 vitest 层。`tests/e2e/` 下的 Playwright 套件：

| File | Tests | Pass | 备注 |
|---|---:|---:|---|
| `tests/e2e/marketing-routing-split.spec.ts` | 2 | 2 | 1️⃣ `/` 渲染 MarketingLandingPage（CTA + 锚链接 + footer，chromium 才能验证） · 2️⃣ `/login` 全流程登录后跳 `/app/publish` |

历史 test 3（`legacy /publish → /login when anonymous`）已**删除**——这条不变式在 `App.test.tsx` 已由 3 条 legacy-shim anonymous-bounce 测试覆盖：
- `/publish (anonymous) → /app/publish → AuthGuard → /login`（App.test.tsx line 222）
- `/tasks (anonymous) → /app/publish → AuthGuard → /login`（line 228）
- `/logs (anonymous) → /app/publish → AuthGuard → /login`（line 234）

外加 1 条 direct-path test 锁 `AuthGuard` 本身（`/app/publish (anonymous, no shim) → AuthGuard → /login` line 265）。Dropped 处留 7 行注释解释 WHY。详见 §4.4。

---

## 3. 通用约定 (Conventions)

### 3.1 `vi.mock` 工厂位置

vitest 的 `vi.mock(foo, factory)` 在文件级别 hoist，apply 到文件 module 图里的所有 import 解析。`factory` 体内引用的 spy 必须从被测文件可见。约定：

- **被测文件内声明 mock**（不是 helper 里）。`LoginPage.test.tsx` 自己 import `mockUseAuth` 并用 `vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => mockUseAuth() }))`。如果 mock 写在 `redirect-spy.tsx`，它只在 spy 自己的直接 import 时生效，分支不传。
- **factory body 必须 hoist-safe**：不能用文件级只在 `describe` 里定义的常量。约定用 `vi.hoisted(() => ...)`。

### 3.2 `_internal` vi.hoisted 模式

vitest 的 transformer 不允许 `export const X = vi.hoisted(...)`，会抛 `SyntaxError: Cannot export hoisted variable`。约定：hoist 值放进**模块局部** non-exported `_internal` 容器，再导出 dereferenced refs。

```ts
// src/test/auth-router-spies.ts  (实际源 lines 13-26)
const _internal = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseAuth: vi.fn(),
}))
export const mockNavigate = _internal.mockNavigate
export const mockUseAuth = _internal.mockUseAuth
```

详见 `src/test/auth-router-spies.ts` 顶部 docblock（"IMPORTANT — vi.hoisted MUST NOT BE EXPORTED" 段）。

### 3.3 共享名元素的 `within()` 锁定

当两个不同组件渲染同名 button（`新建分组` 在 PageHeader 槽 + GroupToolbar stub）或同 test-id（`publish-ai-sidebar` 在 PublishPage 桌面列 + 移动 drawer），约定**用 `within(subtree)` 锁定来源**，而不是放宽到 `getAllByRole().length >= 1`：

```ts
// 桌面 column vs 移动 drawer 两个 PublishAiSidebar — 锁定 drawer
within(screen.getByTestId('mobile-ai-drawer'))
  .getByTestId('publish-ai-sidebar')
```

放宽度（`getAllByRole + length >= 1`）会让"PageHeader 停止渲染 actions 槽"这类回归**静默通过**，因为 GroupToolbar stub 还独立渲染同名 button。`within()` 是默认选择。

### 3.4 `data-testid="page-header-actions"` substrate

`src/Components/ui/page-header.tsx`（实际源 lines 54-58）的 actions 容器加了 `data-testid="page-header-actions"`（`{actions && (...)}` 条件渲染）。这是 `src/Pages/AccountsPage.test.tsx`（lines 169-186）锁定 PageHeader 自己 action 槽的 substrate 契约。**重命名 grep AccountsPage.test.tsx 同步**。`page-header.tsx` 内有 4 行注释 link 合约。

### 3.5 失败里的 ECONNREFUSED

`TestProviders`（详见 `src/test/render-harness.tsx` lines 11-20）包的是**真 `QueryClient`**——data hook（`useTasks` / `useAccountGroups` / `useAccounts`）如果不 stub，会触发 axios → vitest-fetch → ECONNREFUSED。约定组件级 vitest spec 必须显式 mock 这些 hook 或 stub 网络层。

### 3.6 `redirect-spy.tsx` helper 长什么样

`src/test/redirect-spy.tsx`（实现 lines 33-87）暴露 `mountLoginPage({ isAuthenticated, isLoading, ... }) → { navigateSpy, clickEmailSubmit, clickCodeSubmit }`。`within` imported from `@testing-library/react`。应用全部 vitest LoginPage + AccountsPage/PublishPage/App.tsx 镜像测试。

> 注：`.tsx` 后缀不可改 `.ts`，因为 helper 内部用 `render(<LoginPage />)` JSX（实际源 line 71）。`@vitejs/plugin-react` 仅在 `.tsx` / `.jsx` 上 transform JSX——之前 round-1 踩过这个洞。

---

## 4. 跨层协作 (Cross-Tier Notes)

### 4.1 vitest → AppShell chrome

| e2e 测试 | vitest 接管 |
|---|---|
| `tests/e2e/marketing-routing-split.spec.ts` test 1 (`/` MarketingLandingPage) | 保留 e2e（chromium-only anchor + footer render） |
| `tests/e2e/marketing-routing-split.spec.ts` test 2 (`/login` 全流程 → `/app/publish`) | 保留 e2e（mock 完整 `/api/auth/*` 链路才能跑全流程） |
| 旧 test 3 (legacy `/publish` → `/login` 匿名 bounce) | `App.test.tsx` 中 6 条 anonymous-bounce 测试覆盖 ✅ |

### 4.2 待修复的 pre-existing 失败（未在本轮 work 内）

| File | Fail | 根因 | Fix 方向 |
|---|---:|---|---|
| `AiPanelToolbar.test.tsx` | 5 | `getByText('gpt-4o-mini')` 在 `hidden md:flex` 块外侧 match 不到 desktop-only 文本 | 用 `within('.hidden.md\\:flex').getByText(...)` 收窄 |
| `ChatArea.test.tsx` | 4 | react-markdown 10.x 移除了 `<Markdown className=...>` 形态 | 迁到 `components={{ p: (props) => <p {...props} /> }}` 形式 |
| `NoteForm.test.tsx` | 6 | `vi.mock('@/Components/ui/index')` 工厂未返回 `AlertDialog` 导出 | 在 mock 对象加 `AlertDialog: ({ children }) => <>{children}</>` |
| `VideoForm.test.tsx` | 8 | 同 NoteForm | 同上 |
| `TaskDrawer.test.tsx` | 2 | React 19 strict-mode 双 render → `inner.phases.length === 2 !== 1`；accordion 触发器查询为空 | `act + waitFor` 包裹 + 同步 anchor 关键字 |
| `TaskTableRow.test.tsx` | 1 | 同 React 19 strict-mode | 同上 |

> 这 26 失败与本轮 e2e→vitest 迁移无关，是 vitest-results 历史遗留。已纳入 suggestion queue。

### 4.3 vitest ↔ e2e 加一条简单判定

如果不变式满足以下任一，把测试搬到 vitest：
- ❌ 不需要 chromium（anchor link 实际跳转、cookie 行为、console error、page error）
- ❌ 不需要真实 http（fetch /api/*）
- ❌ 不需要 1 个以上 viewport（只用 1024×768 desktop）

否则保留 e2e。

### 4.4 e2e slim 协议

删 e2e 测试前留 7 行 Dropped 注释：
- WHY：被哪个 vitest spec 哪一条测试接管
- WHEN to re-add：e2e 才能复现的回归类型（chromium CSP、cookie 行为、console 中不可在 RTL 验证的 side effect）

不要凭印象写"节省 X 秒"——chromium 启动 + Vite warm-up + `/api` mock 配置主导，per-test 边际时间极不稳定。

### 4.5 `/app/inbox` concurrent-download chip contract（OPT-3F+）

[`/app/inbox`](src/Pages/InboxPage.tsx) 用 `inflightEntryIds: Set<string>` + `batchBusy: boolean` 替换原全局 `busy: boolean`（旧实现下任何一格 download in-flight 都会锁死整个 URL input / paste / download 按钮，正是 user 报告的 bug）。本轮在 `src/Pages/InboxPage.test.tsx` 加 4 条 lock test，均落在 "Concurrent-downloads contract" 或 "cleanup paths" `describe` 块末尾，collective 锁住 chip invariant + 5 条 mutation path（`handleDownload` / `handleRetry` / `handleBatchRetry` / `handleRemove` / `handleBatchRemove` / `handleClearAll`）：

| # | Test (it) | 锁住的 invariant | 回归后果 |
|---|---|---|---|
| 1 | `double-defense: a second click on 「重试选中」 during an in-flight batch does NOT re-fire inboxDownload for the same entry` | `handleBatchRetry` re-entrancy：Layer 1 = `batchBusy` debounce 按钮，Layer 2 = `!inflightEntryIds.has(id)` per-row 过滤 | 用户在 batch 慢请求期间双击「重试选中」，inboxDownload 对同 URL re-fire，加重 server + UI duplicate |
| 2 | `removing an in-flight entry clears the in-flight count chip immediately` | `handleRemove(id)` 必须 sync `clearInflight(id)` 跟着 `setEntries` | 删除 in-flight row 后 chip 出现鬼影计数 |
| 3 | `batch-removing in-flight entries clears the in-flight chip immediately` | `handleBatchRemove()` 必须 per-id `clearInflight(id)` 每个选中 entry | 同 ghost-count bug，multi-row 变体 |
| 4 | `clearing all in-flight entries clears the in-flight chip immediately and drops to empty state` | `handleClearAll()` 必须 atomic `setInflightEntryIds(prev => prev.size === 0 ? prev : new Set())` + reset `selectedIds` + reset entries | 点「全部清除」后 chip 不归零，UI 与用户意图相反 |

4 条测试一起被 CI vitest gate `.github/workflows/ci.yml` 的 `frontend-vitest` job 接管（5 spec 总规模）。CI runtime 从原 4-spec ~1 s 上升到 5 spec ~5.5 s（InboxPage.test.tsx 单文件 59 test 占绝大部分）——见 §5.1。同步做的视觉验证（browser-use end-to-end）也确认 chip 从 `2 in-flight` → Trash 删除后 `1 in-flight` → `全部清除` 后 chip 整段消失，无 phantom residue。

> §4.2 列出的 26 个 pre-existing failures 与本 contract 完全无交集：失败路径都落在 legacy vi.mock 工厂（AlertDialog 缺失 / react-markdown 10.x className 迁移 / React 19 strict-mode memo counter 跳变），跟 inflight chip 状态机不共享代码。

---

## 5. 一次跑完的命令 (Run Targets)

```bash
# Verbose full run → 保存到 /tmp/vitest-suite.txt（PR 评审一手数据）
cd sau_web/frontend && pnpm exec vitest run --reporter=verbose 2>&1 | tee /tmp/vitest-suite.txt

# 只跑本轮 5 个 spec（routing + auth-router + page-chrome + concurrent-download chip contract）
cd sau_web/frontend && pnpm exec vitest run \
  src/Pages/AccountsPage.test.tsx \
  src/Pages/PublishPage.test.tsx \
  src/App.test.tsx \
  src/features/auth/LoginPage.test.tsx \
  src/Pages/InboxPage.test.tsx

# Playwright e2e 流（仅 marketing-routing-split 2 tests）
# 注意：playwright config 在 repo 根目录（`../../tests/playwright.config.ts`），
# 不是 `sau_web/frontend/` 下；不带 `--config` 会找不到 spec。
pnpm exec playwright test --config ../../tests/playwright.config.ts tests/e2e/marketing-routing-split.spec.ts

# 等价的 package.json script（`e2e` script 默认 select all specs）
cd sau_web/frontend && pnpm exec playwright test --config ../../tests/playwright.config.ts --grep "Marketing \+ Shell"
```

### 5.1 CI gate（`.github/workflows/ci.yml`）

新增 `frontend-vitest` job（与 `frontend-build` 并发跑）：

- **作用**：锁定 post-merge 三类不变式——routing table、auth-router redirect、PageHeader + action-data-testid substrate
- **选 spec 范围**：只用 **5 个 core spec**（`App.test.tsx` + `LoginPage.test.tsx` + `AccountsPage.test.tsx` + `PublishPage.test.tsx` + `InboxPage.test.tsx`）。后者覆盖 `/app/inbox` 的 concurrent-download chip contract（详见 §4.5）。完整套件另 **12 个文件**含 26 个 pre-existing failure（未在本轮 work 内），需分批修才能引入完整 gate。详见 §4.2 。
- **运行时间**：本地 ~5.5 s · **99/99 PASS**（17 routing + 5 LoginPage + 8 AccountsPage + 10 PublishPage + 59 InboxPage = 99）——远低于 `frontend-build` 的 npx tsc + vite build。runtime 上升主要来自 InboxPage.test.tsx 单文件（59 test）；4-spec 时代的 ~1 s 基线已经扩容。如果 InboxPage 继续加 spec，runtime 会进一步上升，建议 future work 把 InboxPage 拆为多个 narrow spec 以稳定 CI 时间预算。
- **依赖**：仅 `setup-node@v4` + `npm ci`（用 package-lock.json 作 cache dependency path），**不需** Postgres 服务、chromium、live backend
- **触发条件**：push 到 main + pull_request 到 main，与 `frontend-build` 同 trigger；互相不依赖，可并发跑。
- **失败时**：`if: failure() 上传 `vitest-summary` 构件，供调试。

---

## 6. 相关文件 (Related Files)

- `vitest.config.ts` — happy-dom + jsdom 环境，`include: ['src/lib/**/*.test.ts', 'src/**/*.test.tsx']`
- `src/test/setup.ts` — global setup
- `src/test/render-harness.tsx` — `TestProviders(QueryClient)` wrapper
- `src/test/auth-router-spies.ts` — `mockUseAuth` / `mockNavigate` 共享 spies
- `src/test/redirect-spy.tsx` — `mountLoginPage()` helper
- `tests/e2e/marketing-routing-split.spec.ts` — 唯一活跃 web-shell e2e

---

> Page updated to reflect `pnpm exec vitest run --reporter=verbose` 一次性结果。本文档随 spec 增删、helper 演进同步更新。
