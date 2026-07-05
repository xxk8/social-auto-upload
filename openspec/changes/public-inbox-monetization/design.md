## Context

`http://localhost:5180/app/inbox` 是产品最"立竿见影"的功能（粘贴链接 → 拿到 mp4 + 文案），但被 `AuthGuard` 锁住，必须登录才能用。营销页 CTA "立即开始" 实际跳到登录页，跳出率高于 SaaS 同类工具（业内参考 70%+ 跳出）。

产品决策时间线：

1. **0-3 月**：开 `/try` 公开试用页（无需登录），3 次/天免费 + 5s stub 广告按钮测转化
2. **0-3 月**：Affiliate 推广同步上线（VPS / API 推广，单次佣金 $50-200 远高于广告 CPM）
3. **0-3 月**：EthicalAds 申请同步（隐私优先，开发者向；fallback Carbon Ads → BuySellAds）
4. **3-6 月**：根据 Phase 1 数据决定是否启动优量汇合规化（企业资质 + 软著 + ICP，详见 DR2）
5. **6-18 月**：根据流量规模决定 BuySellAds 自营赞助位 / 私有化 License

**关键约束**（基于 Gemini 架构评估）：

- patchright 平台（抖音 / 小红书 / 快手）**不能**对访客开放 — chromium 内存 + 95% 失败率 + 12 GB 内存增量
- 访客泳道**必须**物理隔离 — 满后快速 429，绝不阻塞 VIP
- IP 限流**先于**配额 — 5-10 IP/day 硬卡 + 24h lock

## Goals / Non-Goals

### Goals

- 公开 `/try` 页面：6 平台 yt-dlp 白名单 + 3 次/天免费 + 5s stub 广告
- 访客文件隔离 + 1h 自动清理
- Affiliate 推广位 3 处上墙
- EthicalAds 申请 + SponsorSlot 组件
- 轻量自研埋点 + kill criteria 监控
- 0 行回归（现有 `/app/inbox` + metering 系统不动）

### Non-Goals

- ❌ 不实现 patchright 平台对访客开放（架构决策，详见 DR1-DR3）
- ❌ 不实现真实广告接入（Phase 1.5 stub 测转化，Phase 2 推迟 6 月）
- ❌ 不实现企业资质合规化（推迟 6 月，详见 DR2）
- ❌ 不实现支付 / 订阅（独立 change）
- ❌ 不引入新依赖（`yt_dlp` / `patchright` / `requests` 复用）

## Decisions

### D1: 平台白名单仅 6 个 yt-dlp 系

**决策**: `PUBLIC_INBOX_HOST_WHITELIST` = 11 个 host 覆盖 6 平台：`youtube.com` / `youtu.be` / `twitter.com` / `x.com` / `t.co` / `instagram.com` / `facebook.com` / `fb.watch` / `tiktok.com` / `bilibili.com` / `www.bilibili.com`

**理由**: yt-dlp 系平台成功率高（>95%），无 chromium 内存开销；B 站走 BBDown 也不需要登录态；`v.qq.com` / `ixigua.com` 等纯 yt-dlp 但 eCPM 低 + 维护成本高的暂不开放（避免 6 平台扩成 10+ 平台增加边界复杂度）。

**替代方案**: 全平台开放（含 douyin / xhs / ks patchright） — **拒绝**，详见 DR1-DR3 + Gemini 量化评估：12 GB 内存增量 + 95% 失败率 + 12 人天补偿。

### D2: 访客泳道信号量物理隔离

**决策**: `web_runner/executor.py` 新增 `_guest_inbox_sem = BoundedSemaphore(2)`，与原 VIP `_inbox_sem`（cap=8）物理隔离。

**理由**: 4 worker × (2+8) = 40 实际全局并发；访客池满后**立即** 429，绝不阻塞 VIP。`_inbox_guest_sem` 与 `_inbox_sem` 各自维护 waiters 队列，跨池不互通。

**替代方案**: 共用 `_inbox_sem` — **拒绝**：匿名流量一冲付费用户就 429，损害产品口碑。

### D3: 配额独立 `guest_usage_logs` 表

**决策**: 新建 `guest_usage_logs (id, guest_uuid, ip, action, created_at)` + 索引 `idx_guest_action_time`，与 `usage_logs` **完全隔离**。

**理由**:

- 匿名访客会产生海量"垃圾数据"（爬虫、乱刷、跳出），粗暴按天 DELETE 不影响 VIP 数据
- 未来做核心业务统计不需要 `WHERE guest_id IS NULL` 过滤
- 反滥用字段（IP / fingerprint / 异常模式）可灵活加

**替代方案**: 复用 `usage_logs` 加 nullable `guest_uuid` 列 — **拒绝**：表膨胀 + 查询条件复杂 + 不可粗暴清理。

### D4: 访客文件 1h 过期 + `videos/inbox/public/` 隔离

**决策**: 访客下载文件落到 `videos/inbox/public/`，1h 后 janitor 删除；VIP 文件保留 24h。

**理由**:

- 访客产生文件量级高（每天访客 × 3 次 × 平均 50MB = 几十 GB），24h 保留成本不可接受
- 隔离目录便于高频清理（不必扫描全部 inbox）
- 与 `DESIGN.md boundaries.m3u8-deep-fetch` 路径 C 决策联动 — m3u8 < 64KB 主动放弃 + 1h 过期 = 双重保护

**替代方案**: 全局 24h 统一策略 — **拒绝**：访客流上线后磁盘爆炸。

### D5: IP 限流先于配额

**决策**: IP 限流（单 IP 10 次/天）在 `before_request` hook 早期执行；配额检查在后。

**理由**:

- 单个恶意 IP 切换 UUID 即可绕过 `sau_guest_id` cookie（清浏览器 cookie 成本极低）
- IP 限流是粗粒度防滥用；配额是细粒度正常用户
- 24h IP lock header 配合 `Retry-After: 86400`，明确阻断重试

**替代方案**: 仅靠 `sau_guest_id` cookie — **拒绝**：UUID 跟 IP 解绑后无解。

### D6: Affiliate 主路径 + EthicalAds 补收益

**决策**: Affiliate 链接 3 处上墙（Dashboard 侧栏 / `/try` 完成态 / Pricing 页），与 Phase 1 同步上线；EthicalAds 申请同步启动，5-7 工作日审核通过后接入 SponsorSlot 组件。

**理由**:

- Affiliate 单次佣金 $50-200 远高于广告 eCPM $0.50-1.10
- 零技术对接成本（纯链接 + `ref=sau` tag）
- EthicalAds 隐私优先，符合 engineering-tool 调性
- Carbon Ads 作为 EthicalAds 申请失败的 fallback（详见 DR4）

**替代方案**: 推迟到 Phase 2 — **拒绝**：Affiliate 零技术债，越早上越好。

### D7: 暂不启动企业主体合规化

**决策**: 优量汇 / 穿山甲接入所需的企业资质（营业执照 + 对公 + 软著 + ICP）**暂不启动**。

**理由**:

- 当前无企业主体，启动需 45 人天行政 + 几千元成本
- 在 Phase 1 数据（按钮 CTR / Affiliate 转化）出来前启动 = 沉没成本
- 数据达标后再启动（Phase 2 中期，3-6 月，详见 DR2）

**替代方案**: 现在就注册公司 — **拒绝**：时间窗不对。

### D8: 轻量自研埋点

**决策**: `/api/public-inbox/beacon` 接收前端 `navigator.sendBeacon` 上报的 5s 中断事件；`/api/public-inbox/reward` 记录成功回调。零依赖，自己写。

**理由**:

- 隐私优先，符合 engineering-tool 调性
- kill criteria 监控仅需：按钮 CTR + 5s 完成率 + Affiliate CTR
- 第三方分析（GA4 / Plausible）国内用户薅 AdBlock，数据不完整

**替代方案**: GA4 / Plausible — **拒绝**：与隐私调性冲突 / 数据不完整。

## 决策记录 — 被否方案

### DR1: Google AdSense — 拒绝

**结论**: **NO**。纯 AdSense 网页版**不内置**激励视频，要激励回调必须升级到 Google Ad Manager (GAM)，那是企业级复杂产品。**且**为了过审必须把 Vite SPA 改造为 SSR（Next.js / Nuxt），还要生造 20 篇深度原创技术文章 + Privacy Policy + About + Contact 页面。

**引用调研事实**:

- 调研 A.1：审核周期 2-4 周
- 调研 A.5：工具类常被拒，需 15-20 篇深度文章
- 调研 A.4：纯 AdSense 没激励视频；升级到 GAM 是企业级复杂度
- 调研 A.2：SPA 必须 SSR，否则爬虫判定"无内容"被拒

**工作量**: 极大（前端 SSR 重构 + 20 篇文章 + GAM 接入）

**风险**: 极高（沉没成本后仍可能因"无内容"被拒）

**替代方案**: 走 GAM 做激励视频 — **拒绝**，等数据证明需求再考虑。

### DR2: 优量汇 (Tencent AdUnion) — 拒绝（短期）

**结论**: **NO**。平台硬约束"仅限企业账户 + 软著 + 对公"，当前无主体直接死锁。

**引用调研事实**:

- 调研 B.1：审核周期 1-3 工作日（**这本身没问题**）
- 调研 B.2：个人开发者**明确不支持**。TradPlus 文档原话："广告平台要求账号性质必须是企业账户，不支持和个人开发者合作。收款银行务必为该企业的对公账户"
- 调研 B.5：必需营业执照（三证合一）+ 对公收款账户 + ICP 备案 + **软著证**
- 调研 B.6："看广告"标准模式成熟（用户主动点击 → 后端签名校验 → 发放奖励）— **这是 Phase 2 中期的目标路径**

**工作量**: 法务/行政级（企业注册 + 软著申请需月级别）

**风险**: 合规前置，跑不通资质就一直是 0%

**替代方案**: 推迟到 Phase 2 中期（3-6 月），看 Phase 1 数据决定是否启动 — **采纳**，与 D7 一致。

### DR3: 穿山甲 (Pangle / 巨量引擎) — 拒绝

**结论**: **NO**。明确不支持 H5 / 小程序 / PC 网页 / Web 技术栈，仅支持纯原生 App（Android / iOS / Unity / 鸿蒙），且 App 必须已上架主流应用商店。

**引用调研事实**:

- 调研 C.1：审核周期 1-3 工作日
- 调研 C.2：个人开发者**明确不支持**，"仅限企业法人"
- 调研 C.3：核心硬约束 — **不支持 H5 / 小程序 / PC 网页 / Web 技术栈**。仅支持纯原生 App
- 调研 C.4：必需营业执照 + 对公账户 + **软著** + ICP 备案
- 调研 C.5：激励视频 ✅ 全量支持（但本项目用不到）

**结论**: 对本项目**直接判死** — 我们是 Web SPA，且无企业资质，且无原生 App。

**替代方案**: 把 Web 封装成原生 App — **拒绝**：项目核心定位是 engineering-tool Web，封装成 App 等于完全重定位。

### DR4: Carbon Ads — 备用（不作为主路径）

**结论**: 作为 EthicalAds 申请失败的 fallback。**不**作为主路径。

**理由**:

- 邀请制，5-7 工作日审核，门槛高
- 纯展示广告，**无激励视频**
- eCPM $0.50-1.10，受众偏北美/欧洲，国内访客几乎无广告展示
- 审核严格，不符合"工程工具"的极简风格时直接被拒

**触发条件**: EthicalAds 申请被拒 → 转 Carbon Ads 申请。两次都失败 → 撤掉 SponsorSlot，仅保留 Affiliate。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| patchright 流量意外通过白名单（host 解析绕过） | 后端 `_is_public_url` + `_resolve_is_public` SSRF 闸门复用，**先于** yt-dlp 调用 |
| 访客流 `_inbox_guest_sem` 满后第 3 个 429 → 用户立即跳出 | 429 响应体内返回 "升级 Pro 享无限额度" 引导；与 PricingPage CTA 链联动 |
| Affiliate 选品质量差，CTR < 0.3% | 30 天滚动监控 + kill criteria 触发重选品；初始 5-10 个候选 + 30 天数据迭代 |
| EthicalAds 申请被拒 | fallback 到 Carbon Ads；fallback 失败 → 撤掉 SponsorSlot，仅保留 Affiliate |
| `SAU_AUTH_ENABLED=false` 模式访客测试冲突 | public_inbox.py 强制走 guest 路径，不沾 synthetic admin user |
| 访客文件 1h 过期 → 用户尚未下载完成 | janitor 在 `_try_*` 调用期间跳过（`p.st_mtime + TTL < now` 才删） |
| Chromium 反爬升级 → yt-dlp 也开始被拦截 | kill criteria：若 6 平台下载失败率 >20%，立即停用访客流，仅保留登录用户 |
| HMAC nonce 表无限增长 | nonce 表 LRU 淘汰（按时间窗口 60s 滚动） |
| Beacon 端点被滥用写表撑爆 | 限流 + 仅接受 `event ∈ {reward_abandon, reward_complete}` 枚举值 |

## Migration Plan

**Phase 1** (Tasks 1-2): 后端骨架 + 中间件（零外部影响）
**Phase 2** (Task 3): 后端测试
**Phase 3** (Task 4): 前端公开面
**Phase 4** (Task 5): 前端变现
**Phase 5** (Tasks 6-7): 文档 + 验证
**Phase 6** (Task 8): 监控埋点

每 Phase 可独立 merge + revert。建议 PR-A 后端 + 测试，PR-B 前端公开面，PR-C 变现 + 文档，PR-D 监控。

## Kill Criteria 速查表

| 指标 | 阈值 | 触发动作 |
|---|---|---|
| `/try` 看广告按钮 30d CTR | < 5% | 撤掉 stub 按钮，重写 LandingPage CTA → "注册送 5 次" |
| 5s 倒计时中途流失率 | > 70% | 缩短 stub 到 3s，A/B 测试无奖励流 |
| Affiliate 30d CTR | < 0.3% | 重选品或撤掉 AffiliateRail |
| 注册转化率 | < 2% | 注册墙文案 + 时机重做 |
| 月活访客 < 5k（持续 3 月） | 触发 | 推迟优量汇合规化（DR2 维持拒绝） |
| 6 平台下载失败率 >20% | 触发 | 停用访客流，仅保留登录用户 |

监控入口：`/api/public-inbox/admin/funnel`（admin required）。

## Open Questions

- EthicalAds 申请被 Carbon Ads fallback 失败时，撤掉 SponsorSlot 还是接 BuySellAds 自营？— Phase 1.5 决定。
- `/try` 完成后是否引导用户"扫码加群" / "邮件订阅"？— 留到 v0.1，避免一次性加太多触点。
- 访客跨设备同步：是否用 IP + 浏览器指纹作为第二识别键？— 留到 v0.1，Phase 1 仅 `sau_guest_id` cookie。
- 6 平台白名单的 `m.tiktok.com` / `vm.tiktok.com` 等子域名需要测试覆盖吗？— Phase 2.5 测试矩阵补全。
- Affiliate 候选品在 en-US / zh-CN 站点是否需要分别选品？— Phase 1 统一中英文同一批品，按 `Accept-Language` 切换后续可考虑。
