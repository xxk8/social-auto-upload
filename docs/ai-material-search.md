# 图片素材搜索 (Pexels + Pixabay) — Operator Runbook

> **给运维 / 上线者**：把免费 Pexels + Pixabay 图像搜索 token 接入 `/app/publish` 的 AI 助手侧栏。锚定到 `openspec/changes/ai-sidebar-material-search`（实现见 `web_runner/routes/ai.py` §1 三路由 + 前端 `MaterialSection`）。

## Why this exists

`/app/publish` 第 0 步的 AI 助手侧栏有一个「图片素材」折叠 panel（`sau_web/frontend/src/Components/AiRightPanel/MaterialSection.tsx`），支持：

- **手动搜图**：用户输入关键词 → 后端并发请求 Pexels + Pixabay → 3×3 缩略图网格 → 单击添加到图文附件 / 视频封面。
- **自动推荐**：用户编辑标题 1.5s 后空闲 → 后端按当前标题推荐 9 张候选（独立 slot，不覆盖手动结果）。每个 panel mount 内最多 3 次。

两个 panel 都没有 key 时，`POST /api/ai/images/search` 直接返 **HTTP 503 + 中文一句话提示**：

```
{ "success": false, "code": "IMAGE_SOURCE_NOT_CONFIGURED",
  "message": "未配置图片搜索 API key。请在 .env 设置 PEXELS_API_KEY 或 PIXABAY_API_KEY 后重启 run.py。" }
```

按本文档 5 分钟内可上线至少一个数据源。两者都配 = 双源聚合 + 去重 + 9 张/次的网格。

## Prereqs

- 一个能收邮件的邮箱（注册两服务都必须实名邮箱验证，不能用临时邮箱）。
- 项目 `.env` 文件（标准 onboarding：`cp .env.example .env`）。
- 不需要信用卡，Pexels / Pixabay 两个 free tier 都完全免费。

## Setup — 5 分钟接一个源

### A. Pexels（推荐默认）

1. **Sign up**：浏览器打开 <https://www.pexels.com/join/>，邮箱 + 密码 **或** Google auth 都行，注册后会自动登录。
2. **找到 key**：登录态访问 <https://www.pexels.com/api/> → 滚到 **Image & Video API** 段落 → 顶部高亮显示一串 56 位 hex key，**明文**显示（不要截图发群里）。
3. **写入 .env**：在 `.env` 里加一行：

   ```bash
   PEXELS_API_KEY=<刚才那串 56 位 hex>
   ```

4. **重启 run.py** / Flask 后端 — env var 在 `create_app()` 时一次性读取，热重启才会重读（详见 web_runner/routes/ai.py 顶部 `_has_image_source()`）。

### B. Pixabay（推荐第二个并行源，零额外成本）

1. **Sign up**：浏览器打开 <https://pixabay.com/accounts/register/>，邮箱 + 密码（**没有** Google auth 选项）。
2. **找到 key**：登录态访问 <https://pixabay.com/api/docs/> → 页面右侧或顶部高亮显示一串 32 位字符的 key，明文。
3. **写入 .env**：

   ```bash
   PIXABAY_API_KEY=<pixabay 32 位>
   ```

4. **重启 run.py**。

> **Skip 提示**：只配 Pexels 也 ≥ 可用，Pixabay 是「多一个备用源 + 图库更大」的双源加成。两条都配 = 后端 `ThreadPoolExecutor(max_workers=2)` 并发聚合，单源失败另一个兜底（partial-degradation path），spec §"Partial degradation" 已锁定。

## Verify — 一次跑通

重启后端后，从命令行直接打 API smoke：

```bash
# 假设你已经登录拿到一个能用的 session cookie（先 /login 走邮箱验证码），
# 或者临时打开 .env 里 SAU_AUTH_ENABLED=false 跳过 auth

curl -X POST http://localhost:6001/api/ai/images/search \
  -H 'Content-Type: application/json' \
  -b /tmp/sau-cookies.txt \
  -d '{"query":"周末咖啡","count":9}'
```

期望响应（成功）：

```json
{
  "success": true,
  "data": [
    {"id": "pexels:12345", "source": "pexels", "thumb": "...", "preview": "...", "full": "...", "photographer": "Anna Smith", "photographerUrl": "...", "pageUrl": "...", "alt": "coffee..."},
    {"id": "pixabay:67890", "source": "pixabay", "thumb": "...", ...}
  ],
  "debug": {"pexels_count": 5, "pixabay_count": 4, "merged_count": 9}
}
```

期望响应（**没配 key**）：

```json
{"success": false, "code": "IMAGE_SOURCE_NOT_CONFIGURED", "message": "未配置图片搜索 API key..."}
```
HTTP status = **503**。

期望响应（**触发限流**）：

```json
{"success": false, "code": "RATE_LIMITED", "message": "image search rate-limited; retry after 60s", "retry_after_sec": 60}
```
HTTP status = **429** + `Retry-After: 60` 头。

> **修客户端前先看这个**：如果 503，立刻查 `.env` 里 key 是不是写进去了 + 后端是不是真的重启了（Uvicorn/gunicorn `-reload` 不读 `.env`，只读 `os.environ`）。

## Rate limits & quota — 我能跑多少次？

| 服务 | 限流（free tier） | 月配额 | 备注 |
|---|---|---|---|
| **Pexels** | **200 req/hour** | 20,000 req/month | two axes — 限流 + 月配额都会触发 429 |
| **Pixabay** | **100 req/60 秒** | （不计月配额，per-min cap 即可耗尽） | 24h 缓存要求（Pixabay T&C 要求） |

两个服务器端还有什么 "unlimited tier" 申请选项：

- **Pexels Unlimited**：写一个简短的 attribution+usage 申请表（<https://help.pexels.com/hc/en-us/articles/900004372046>），人工 review；通过后破月度/小时配额，列入长期运营再提交。
- **Pixabay limit increase**：实现合规 → <https://help.pixabay.com/hc/en-us/articles/14473151-The-Image-API-100-Free-Calls-per-60-seconds> 提需求，14 天 review。

**侧栏服务端还有一层防护**（spec §"Soft rate limiting"）：

- 后端做了 **per-user, 30 req/min 的滑动窗口**（已实现，`web_runner/routes/ai.py::_check_image_rate_limit`）。即使用户手动狂点，也会先 429 阻止打到 Pexels/Pixabay，避免 free tier 被烧光。
- 自动推荐 side 还有 **session 级 cap**（每 mount 最多 3 次）— 用户编辑标题 50 次也只触发 3 次。

## Troubleshooting

| 现象 | 真根因 | 修法 |
|---|---|---|
| `/api/ai/images/search` 持续 503 | `.env` 没写入 或 run.py 没重启 | `grep PEXELS .env` 检查 + `.sau-logs/` 里 `_has_image_source()` 启动日志确认 |
| 偶发 429 + Retry-After: 60 | 触发了 Pexels hourly cap 或 Pixabay 60s cap | 默认 60s 后自动恢复；如果持续，联系 Pexels/Pixabay 申请提额 |
| 9 张结果全是 Pexels（无 Pixabay） | 只配了 PEXELS_API_KEY | 把 PIXABAY_API_KEY 也加进 `.env` 重启 |
| 9 张结果都是同一 source 但内容不一致 | 正常 — 双源去重只在同源内做（Pexels / Pixabay CDN 不同，跨源永远不会重复） | 无须处理，这是 spec intent |
| 401 Unauthorized | `SAU_AUTH_ENABLED=true` 但没用 session cookie | 先 `/login`，再用 cookie，或临时关 auth 跑 curl |
| 后端日志报 `_has_image_source() → False` 而前端没显示 503 | 前端停留在前次成功的 cache（Cache-Control: max-age=300） | 5min 后自动刷新，或加 `Cache-Control: no-cache` header 强制拉新 |

## T&C compliance — 务必遵守的 3 条

1. **Attribution**：在产品里展示 Pexels / Pixabay 图片时，"Photos by Pexels"/"Pixabay" 必须可点到 / 显眼可见（spec 要求归一化 schema 里的 `photographerUrl` 字段就是为这个）。我们的网格每个 tile hover 时显示「来源 · 摄影师」就是最小合规形式 — **不要**改 / 删这个 badge。
2. **不复制 Pexels / Pixabay 主体功能**：不能直接做一个 "Pexels wallpapers" 镜像站。
3. **不永久 hotlink**：每次展示走我们的 `/api/ai/images/fetch?url=...` 后端代理（spec §"Image binary fetch proxy"），而不是浏览器直连 Pexels/Pixabay。原因是 CORS + 我们的 SSRF 闸门需要服务端中转。

## Cross-references

- **后端**：`web_runner/routes/ai.py` — `_search_pexels` / `_search_pixabay` / `_merge_image_results` / `_fetch_image_proxy` 私有函数 + 三路由 `POST /api/ai/images/search` + `POST /api/ai/recommend-images` + `GET /api/ai/images/fetch`。
- **后端测试**：`tests/test_ai_image_search.py`（9 个 case：归一化 / 去重 / 503 / partial degradation / cap）+ `tests/test_ai_image_fetch_proxy.py`（5 个 case：SSRF / 10MB cap / Content-Type）。覆盖 spec §"Pexels + Pixabay" / §"SSRF" / §"Soft rate limiting"。
- **前端**：`sau_web/frontend/src/Components/AiRightPanel/MaterialSection.tsx` + `MaterialImageGrid.tsx` + `AddUrlForm.tsx` + `hooks/useMaterialAutoRecommend.ts` + `stores/materialPanelStore.ts`。
- **openspec**：`openspec/changes/ai-sidebar-material-search/specs/ai-sidebar-material-search/spec.md` — 8 Requirements + 23 Scenario 是契约的 source-of-truth；本 runbook 是镜像简化版。
- **运维 hub**：`docs/dev/INDEX.md#operators` — 本文件注册到 Operators 表。
- **CLAUDE.md** — Operations 段那一行指针。

## Frontend vitest spec 命名 pin — `.test.tsx` 不是 `.test.ts`

本 change 引入的两条 vitest spec 文件名后缀是 **`.test.tsx`**（不是 `.test.ts`）。下轮读者按扩展名 grep / file watcher / 静态分析走查时请直接命中以下路径，**不要搜 `.test.ts`**：

| Spec | 路径 | 覆盖的 § |
|---|---|---|
| Store 契约 | `sau_web/frontend/src/stores/materialPanelStore.test.tsx` | §6 searchImages / recommendByTitle / addImageToForm / recentQueries LRU / reset |
| Section 渲染 + 单击 | `sau_web/frontend/src/Components/AiRightPanel/MaterialSection.test.tsx` | §7 Accordion cap + 单击 UX（图片 / 链接 panel）+ §8 manual / recommend 共存 + §9 single-source-of-truth toast |

**为什么 `.test.tsx` 而非 `.test.ts`**：仓库的 vitest include pattern + 项目既有约定这两层都把 store / component / page / feature 一类的 spec 划到 `.test.tsx`（例：`src/stores/publishWizardStore.test.tsx`、`src/Pages/PublishPage.test.tsx`、`src/Pages/InboxPage.test.tsx`、`src/features/publish/SchedulePicker.test.tsx`、`App.test.tsx` 等，仓库内所有现存 vitest spec 均走 `.test.tsx`）；保留 `.test.ts` 会引入与既有约定以及项目 CI gate 名单两层不一致的命名漂移。`.test.ts` 仅限 `src/lib/` 下的纯 logic / utility helper spec（例：tag 解析、text-segment 仓裁并等），仓库里 本项目当下不存在此类纯 logic `.test.ts` 文件。

> **下轮 spec 命名 workspace 约定**：store / component / page / feature 这类含 JSX / React state 的 spec 一律 `.test.tsx`；`src/lib/` 路径下的纯 logic / 函数式 helper spec 可用 `.test.ts`。本节把这个约定 pinned 一次，避免下轮读者按 `.test.ts` 扩展名 grep 找不到本 change 引入的两条 vitest spec。详见 archive PR #237 的「Spec filename convention pin」章节。

## 一个 30-second 的 e2e 验证清单

- [ ] `.env` 里写完 PEXELS_API_KEY 或 PIXABAY_API_KEY
- [ ] run.py / Flask 后端重启
- [ ] 浏览器打开 `http://localhost:5180/app/publish?step=0`（Web Shell 已登录）
- [ ] AI 助手侧栏右下找到「图片素材」Disclosure trigger，点开
- [ ] 输入 "咖啡" + Enter
- [ ] 看见 9 张缩略图（Pexels / Pixabay 混合或仅单源，取决于配置数量）
- [ ] 改一下左侧标题 → 1.5s 后看见另一组「为你推荐」缩略图（如果还没达到 3 次推荐 cap）
- [ ] 单击一张缩略图 → 自动填到图文化附件（图文模式）或视频封面（视频模式）
- [ ] 看 `.sau-logs/` 下的 traceback + log 行确认 Source=pexels/pixabay 调用成功

全部勾上 = 本次部署完成。
