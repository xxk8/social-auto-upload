## 1. 后端骨架 (Web API)

- [ ] 1.1 `web_runner/db.py::init_db()` 新增 `guest_usage_logs (id, guest_uuid, ip, action, created_at)` + 索引 `idx_guest_action_time(guest_uuid, action, created_at)`
- [ ] 1.2 `web_runner/db.py::init_db()` 新增 `reward_events (id, guest_uuid, ip, event, elapsed_ms, created_at)` + 索引 `idx_guest_event_time(guest_uuid, event, created_at)`
- [ ] 1.3 新建 `web_runner/routes/public_inbox.py` 蓝图（`/api/public-inbox/*`）
- [ ] 1.4 端点 `POST /api/public-inbox/download`（复用 `_try_ytdlp`，白名单前置 + SSRF 闸门复用）
- [ ] 1.5 端点 `POST /api/public-inbox/transcribe`（复用 Whisper 路径）
- [ ] 1.6 端点 `POST /api/public-inbox/reward`（HMAC 签名校验 + 配额 +1 + nonce 防重放）
- [ ] 1.7 端点 `GET /api/public-inbox/quota`（guest_id 视角下的今日剩余 + reset_at + kill_criteria_metrics）
- [ ] 1.8 端点 `POST /api/public-inbox/beacon`（sendBeacon 接收 5s 中断事件）
- [ ] 1.9 端点 `GET /api/public-inbox/admin/funnel`（admin required，funnel 各步骤漏斗）
- [ ] 1.10 模块级常量 `PUBLIC_INBOX_HOST_WHITELIST = {"youtube.com","youtu.be","twitter.com","x.com","t.co","instagram.com","facebook.com","fb.watch","tiktok.com","bilibili.com","www.bilibili.com"}`，不匹配返 400 + 中文引导登录文案

## 2. 泳道 + 中间件 (Web API)

- [ ] 2.1 `web_runner/executor.py` 新增 `_guest_inbox_sem = BoundedSemaphore(2)` + `acquire_guest_inbox_slot() / release_guest_inbox_slot()`，与原 VIP 槽位（cap=8）物理隔离
- [ ] 2.2 `sau_guest_id` HttpOnly cookie 中间件（首访生成 UUID，30 天有效；`SameSite=Lax`；优先于 `_check_auth`）
- [ ] 2.3 公开配额中间件（`guest_usage_logs` 计数；超 3 次返 429 + `reset_at` + 中文文案 + `quota_exceeded` 错误码）
- [ ] 2.4 IP 限流（单 IP 每天 10 次；超 429 + 24h lock + `Retry-After: 86400`）
- [ ] 2.5 `web_runner/__init__.py` 扩展 `_AUTH_WHITELIST` 把 `/api/public-inbox/` 加进去（与 `/api/auth/*` 并列）
- [ ] 2.6 `_cleanup_old_uploads` 拆分为双策略：`videos/inbox/*.mp4` 24h + `videos/inbox/public/*.mp4` 1h；执行期间跳过 `p.st_mtime + TTL < now` 检查防误删正在下载的文件
- [ ] 2.7 SSRF 闸门复用（`_is_public_url` + `_resolve_is_public` 直接 import；`SAU_AUTH_ENABLED=false` 模式强制走 guest 路径，不沾 synthetic admin user）
- [ ] 2.8 `/api/public-inbox/reward` HMAC 签名校验（`server-side issued nonce` + 时间戳 ± 60s 窗口）

## 3. 后端测试 (Web API)

- [ ] 3.1 `tests/test_public_inbox.py` 单元测试骨架
- [ ] 3.2 白名单命中（youtube / tiktok / bilibili 等 11 个 host → 200）
- [ ] 3.3 白名单拒绝（douyin / xhs / kuaishou / weibo / 任何未知 host → 400 + 引导文案）
- [ ] 3.4 配额递增（连发 4 个下载 → 前 3 个 200，第 4 个 429 + reset_at + 中文文案）
- [ ] 3.5 泳道阻塞（访客池满 → 第 3 个 快速 429；VIP 池独立测试同时仍可用）
- [ ] 3.6 cookie 缺失自动生成（`Set-Cookie: sau_guest_id=...; HttpOnly; SameSite=Lax; Max-Age=2592000`）
- [ ] 3.7 IP 限流（同 IP 第 11 次 → 429 + 24h lock header + `Retry-After: 86400`）
- [ ] 3.8 reward 回调（HMAC 校验失败 → 401；非法 nonce → 401；过期时间戳 → 401；正常 → 配额 +1 + reward_events 写表）
- [ ] 3.9 beacon 上报（`event=reward_abandon` + `elapsed_ms=2000` → 200 + 写表）
- [ ] 3.10 文件清理（1h 触达 → `videos/inbox/public/old.mp4` 被删；VIP `videos/inbox/vip.mp4` 保留；正在下载文件跳过）
- [ ] 3.11 `SAU_AUTH_ENABLED=false` 模式下强制走 guest 路径（不沾 synthetic admin user，访客测试可见真实流程）
- [ ] 3.12 现有 `tests/test_inbox.py` / `tests/test_usage_metering.py` / `tests/test_db_wrapper.py` 全绿回归

## 4. 前端 — 公开面 (Frontend)

- [ ] 4.1 新建 `sau_web/frontend/src/Pages/PublicInboxPage.tsx`（精简 InboxPage，剥掉批量重试 / 转写流式 / 账号管理 / 拖拽排序 / 多 entry 队列）
- [ ] 4.2 复用 `@/Components/ui/button` / `card` / `input` / `badge` / `page-header` 等现有组件（**不**新建 ui 原语）
- [ ] 4.3 平台 chip strip 仅渲染白名单 6 平台（与 InboxPage 的 `PLATFORMS` 解耦；新常量 `PUBLIC_PLATFORMS`）
- [ ] 4.4 `src/api/client.ts` 新增 `publicInboxDownload / publicInboxTranscribe / publicInboxReward / publicInboxQuota / publicInboxBeacon`
- [ ] 4.5 `src/App.tsx` 加 `<Route path="/try" element={<PublicInboxPage />} />`（**无 AuthGuard**）
- [ ] 4.6 顶部 mini 配额显示条：`今日剩余 N/3 · 看广告 +1`，mono + hairline 边框
- [ ] 4.7 `<AdRewardButton>` 组件：5s 倒计时 → 调 `/api/public-inbox/reward` → 刷新配额；倒计时中可点"取消"放弃
- [ ] 4.8 `LandingPage.tsx` Hero 区嵌入"立即试"输入框（沿用 `boundaries.marketing-surface` 产品话术，不出现 CLI / patchright / 9k+ ⭐ 等技术黑话）
- [ ] 4.9 错误态 UI：白名单拒绝 / 配额耗尽 / IP 限流 → 显示引导登录 CTA + PricingPage 链接
- [ ] 4.10 vitest 测试：`PublicInboxPage.test.tsx`（白名单 UI / 配额显示 / 错误态 / AdRewardButton 倒计时）

## 5. 前端 — 变现 (Frontend)

- [ ] 5.1 `<AffiliateRail>` 组件（hairline 边框、灰底卡片、推荐品 logo + 文字 + `ref=sau` tag）
- [ ] 5.2 Dashboard 侧栏底部接入 AffiliateRail（已登录用户可见）
- [ ] 5.3 `/try` 完成态底部接入（访客 + 登录用户都可见）
- [ ] 5.4 Pricing 页推荐区接入（基于 tier 选品 — 入门推 Cloudflare / Vercel，专业推 OpenAI / Anthropic）
- [ ] 5.5 候选品清单：Cloudflare / Vercel / Railway / Fly.io（基础云）+ OpenAI / Anthropic / Replicate（按需云）+ Namecheap / Porkbun（域名）
- [ ] 5.6 链接格式：`<a target="_blank" rel="sponsored noopener" href="...?ref=sau">`，合规披露文案（"推广"标识显著）
- [ ] 5.7 `<SponsorSlot>` 组件（EthicalAds 申请通过后接入；hairline 边框符合 DESIGN.md engineering-tool 美学；不可与 `boundaries.gradient-text` / `glass-morphism` 冲突）
- [ ] 5.8 EthicalAds 申请材料准备：developer-tool 描述 + 月活 UV + traffic 来源 + 域名（5-7 工作日审核；fallback Carbon Ads → BuySellAds）

## 6. 文档 (Docs)

- [ ] 6.1 新建 `docs/dev/public-inbox-ops.md`：部署 / 验证 / kill criteria 监控 / 调整额度 env / 回滚步骤
- [ ] 6.2 `CLAUDE.md` 在 Operations / on-call 段加 `public-inbox-ops.md` 入口
- [ ] 6.3 `DESIGN.md` 新增 `boundaries.affiliate-disclosure`（合规披露 + `rel` 标签 + `#ad` 标识规则）
- [ ] 6.4 `DESIGN.md` 新增 `boundaries.ethical-ads-markup`（hairline 边框规范 + 不与 sodium-amber 强调色冲突）
- [ ] 6.5 `DESIGN.md` 新增 `boundaries.public-inbox-platform-whitelist`（明示访客仅 6 平台 + 拒绝 patchright 理由）
- [ ] 6.6 `docs/CLI.md` 表格加 6 平台访客流说明
- [ ] 6.7 `README.md` 加 `/try` 公开试用入口（如果 README 有 feature 列表）

## 7. 验证 (Cross-layer)

- [ ] 7.1 `pytest tests/` 全绿（重点 `test_public_inbox.py` + 回归 `test_inbox.py` + `test_usage_metering.py` + `test_db_wrapper.py`）
- [ ] 7.2 `pnpm vitest` 全绿（重点 `PublicInboxPage.test.tsx` + `AdRewardButton.test.tsx` + 回归 `InboxPage.test.tsx`）
- [ ] 7.3 Playwright e2e：`e2e/try-anonymous.spec.ts`（0-登录全流程：粘贴 YouTube 链接 → 200 → 配额 -1 → 配额耗尽 → 看广告 +1）
- [ ] 7.4 curl 回归：`curl /api/public-inbox/quota` 返 `{"success":true,"data":{...}}`
- [ ] 7.5 内存基线：dev server 启动后空载 ~200MB → 访客流并发 2 → 增量 < 400MB（验证泳道隔离有效，未触发 chromium 加载）
- [ ] 7.6 SponsorSlot 挂载验证：EthicalAds 申请通过后挂到 `/try` 底部，e2e 验证点击 sponsor 不 404

## 8. 监控埋点 (Cross-layer)

- [ ] 8.1 `/api/public-inbox/quota` 接口暴露 `kill_criteria_metrics` 字段（按钮 CTR / 5s 完成率 / Affiliate CTR 30 天滚动）
- [ ] 8.2 `/api/public-inbox/admin/funnel` 内部端点返 funnel 各步骤漏斗（admin required）
- [ ] 8.3 kill criteria 文档化到 `docs/dev/public-inbox-ops.md` §4
- [ ] 8.4 30 天滚动监控自动告警（如果未来接入 Plausible / 自建监控）
