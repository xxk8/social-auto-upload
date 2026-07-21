## Why

`http://localhost:5180/app/inbox` 现有的视频下载 + 转写能力是项目最高频的"立竿见影"功能（粘贴链接 → 拿到 mp4 + 文案），但目前被 `AuthGuard` 挡住，**访客无法试用**，必须先注册邮箱才能体验。这导致：

- 营销页 CTA "立即开始" 实际跳到登录页，跳出率高（SaaS 同类参考 70%+ 跳出）
- 无"免费引流"漏斗，GitHub README 进来的访客看不到产品价值
- 错失"看广告解锁"这种已被验证的创作者工具转化模式
- 无可量化的 Affiliate 收入入口（VPS / API 推广，单次佣金 $50-200 远高于广告 CPM）

`/app/inbox` 内部依赖 yt-dlp + patchright + BBDown 三个引擎，对匿名访客开放必须解决：

1. **平台白名单**（拒绝 patchright 给访客流：chromium 内存 + 95% 失败率 + 12 GB 内存增量）
2. **泳道信号量**（匿名流量不挤压 VIP）
3. **配额独立表**（不污染 `usage_logs`）
4. **反滥用**（IP 限流 + SSRF 闸门）
5. **变现路径**（0-3 月用 stub + Affiliate + EthicalAds，**不接真广告**）

本 change 把"公开试用"做出来，同时把"看广告解锁"做成 stub 测转化数据，为 Phase 2 真广告接入做数据准备。

## What Changes

**后端（Web API）**

- 新增 `web_runner/routes/public_inbox.py` 蓝图，挂 `/api/public-inbox/*`，**物理脱离** `_check_auth` 拦截（与 `/api/auth/*` 一样走白名单）
- 新增 `guest_usage_logs` 独立表 + `reward_events` 埋点表（与 `usage_logs` 完全隔离，便于粗暴按天 DELETE 过期数据）
- 新增 `acquire_guest_inbox_slot() / release_guest_inbox_slot()` 泳道信号量（`BoundedSemaphore(2)`，与 VIP 池 8 物理隔离）
- `sau_guest_id` HttpOnly cookie 中间件（首访生成 UUID，30 天有效）
- 平台白名单 `PUBLIC_INBOX_HOST_WHITELIST`（6 个 yt-dlp 系 host）
- IP 限流中间件（单 IP 每天 10 次硬上限 + 24h lock）
- 文件隔离 `videos/inbox/public/` + 1h 自动清理（替换原 24h 全局策略）
- `/api/public-inbox/reward` 看广告 stub 回调 + HMAC 签名校验
- `/api/public-inbox/beacon` 轻量前端埋点

**前端（Frontend）**

- 新增 `sau_web/frontend/src/Pages/PublicInboxPage.tsx`（精简版 InboxPage，剥掉批量重试 / 转写流式 / 账号管理 / 拖拽排序）
- `src/api/client.ts` 新增 `publicInbox*` 方法
- `src/App.tsx` 加 `<Route path="/try" element={<PublicInboxPage />} />`（**无 AuthGuard**）
- `LandingPage.tsx` Hero 区嵌入"立即试"输入框（沿用 `boundaries.marketing-surface` 产品话术，不出现 CLI / patchright / 9k+ ⭐ 等技术黑话）
- 新增 `Components/AdRewardButton.tsx`（5s 倒计时 → 调 reward endpoint）
- 新增 `Components/AffiliateRail.tsx`（hairline 边框，符合 DESIGN.md engineering-tool 美学）
- 新增 `Components/SponsorSlot.tsx`（EthicalAds 容器，hairline 样式）

**变现（Cross-layer）**

- Affiliate 推广链接在 3 处上墙（Dashboard 侧栏 / `/try` 完成态 / Pricing 页推荐区）
- EthicalAds 申请材料准备 + SponsorSlot 接入
- Affiliate 合规披露：`rel="sponsored noopener"` + `?ref=sau` tag + 推广位显著标识

**文档（Docs）**

- `docs/dev/public-inbox-ops.md` 运营 runbook（部署 / 验证 / kill criteria 监控 / 调整额度 env / 回滚步骤）
- `DESIGN.md` 新增 `boundaries.affiliate-disclosure` + `boundaries.ethical-ads-markup` + `boundaries.public-inbox-platform-whitelist` 三个边界
- `CLAUDE.md` 在 Operations 段加 `public-inbox-ops.md` 入口

## Capabilities

### New Capabilities

- `public-inbox-page`: `/try` 公开试用页，复用 yt-dlp 引擎，6 平台白名单
- `public-inbox-api`: `/api/public-inbox/*` 蓝图（download / transcribe / reward / beacon / quota / admin/funnel）
- `guest-usage-tracking`: `guest_usage_logs` + `reward_events` 双表，独立于 `usage_logs`
- `public-inbox-quota`: 3 次/天 + 看广告 +1 + IP 10/天硬卡
- `affiliate-rail`: AffiliateRail 组件 + 3 处挂载点 + 合规披露
- `ethical-ads-sponsor-slot`: SponsorSlot 组件 + hairline 样式
- `public-inbox-ops-runbook`: `docs/dev/public-inbox-ops.md`

### Modified Capabilities

- `web-inbox`: 拆分为 authed `/app/inbox` + public `/try`；后端拆分为 `routes/inbox.py`（登录用户）+ `routes/public_inbox.py`（访客）
- `usage-metering`: 现有 `TIER_LIMITS` 表 + 新增 guest 配额分支；现有 `_ENDPOINT_ACTION_MAP` 不动（只服务于 VIP 路由）
- `inbox-file-cleanup`: 24h janitor 拆分为 VIP 24h + guest 1h
- `marketing-surface`: DESIGN.md `boundaries.marketing-surface` 段加 "Hero 嵌入" 子规则
- `auth-whitelist`: `web_runner/__init__.py:_AUTH_WHITELIST` 扩展含 `/api/public-inbox/`

## Impact

**受影响文件**

- `web_runner/routes/` 新增 `public_inbox.py`
- `web_runner/executor.py` 新增 `acquire_guest_inbox_slot`
- `web_runner/middleware/` 新增 `ip_throttle.py`（或 inline）
- `web_runner/__init__.py` 注册新蓝图 + 扩展 `_AUTH_WHITELIST`
- `web_runner/db.py::init_db()` 新增 2 张表
- `web_runner/utils.py` 提取 `_cleanup_old_uploads` 为 VIP 24h + guest 1h 双策略
- `sau_web/frontend/src/Pages/` 新增 `PublicInboxPage.tsx`
- `sau_web/frontend/src/Pages/LandingPage.tsx` Hero 区嵌入
- `sau_web/frontend/src/Components/` 新增 `AdRewardButton.tsx` / `AffiliateRail.tsx` / `SponsorSlot.tsx`
- `sau_web/frontend/src/App.tsx` 加路由
- `sau_web/frontend/src/api/client.ts` 新增方法
- `DESIGN.md` / `CLAUDE.md` / `docs/dev/public-inbox-ops.md` 文档

**CLI/API/Frontend 三层影响**

- CLI: **无影响**（CLI 入口 `sau_cli.py` 不动；访客流不走 CLI）
- Web API: 新增 1 个蓝图 + 2 张表；与现有 `inbox.py` 物理隔离，**不**修改现有 API 行为
- Frontend: 新增 1 个页面 + 3 个组件；LandingPage Hero 嵌入（仅新增，不删改）

**数据库**

- 新增 `guest_usage_logs (id, guest_uuid, ip, action, created_at)` + 索引 `idx_guest_action_time`
- 新增 `reward_events (id, guest_uuid, ip, event, elapsed_ms, created_at)` + 索引 `idx_guest_event_time`
- 现有 `usage_logs` / `users` / `tasks` 等表**不动**

**依赖**

- 无新增（`yt_dlp` / `patchright` 已在）
- 部署侧 EthicalAds 通过 `<script src>` 引入（0 依赖）

## Acceptance Criteria

1. **匿名访客流程**：
   - 未登录访客访问 `/try` → 200，无需登录
   - 粘贴 `https://www.youtube.com/watch?v=...` 链接 → 后端返 200 + 文件名 → 落到 `videos/inbox/public/`
   - 粘贴 `https://v.douyin.com/...` → 后端返 400 `Guest restricted to yt-dlp platforms, login required`
   - 第 4 次下载 → 429 `quota_exceeded` + `Retry-After` header + 中文文案
   - 点 "看广告解锁" 按钮 → 5s 倒计时 → 调 `/api/public-inbox/reward` → 配额 +1
2. **IP 限流**：单 IP 第 11 次请求 → 429 with `Retry-After: 86400` + 24h lock
3. **文件清理**：访客文件 1h 后被 janitor 删，VIP 文件保留 24h
4. **泳道隔离**：访客池满后第 3 个请求立即 429，不阻塞 VIP 池
5. **埋点**：`reward_button_ctr` / `reward_completion_rate` 可在 `/api/public-inbox/admin/funnel` 接口内查询
6. **不回归**：现有 `pytest tests/test_inbox.py` / `tests/test_usage_metering.py` 全绿
7. **DESIGN.md 边界**：`affiliate-disclosure` / `ethical-ads-markup` / `public-inbox-platform-whitelist` 三个新 boundary 写明
8. **变现就位**：AffiliateRail 在 3 处挂载点均显示；EthicalAds 申请材料就绪（提交状态在 ops runbook 跟踪）
