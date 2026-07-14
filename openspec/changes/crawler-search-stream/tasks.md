# crawler-search-stream — SSE 错误合约 + 异步生成器 teardown 竞态修复

> **Status**:
> - ✅ **In `70508319` (this commit amend)**: aclose race 修复 + 1 个 lock-in 测试 + 调试脚本同步 + delta-format spec
> - ⏳ **Uncommitted (separate commit)**: SSE 401 missing_account 合约 + 前端 button disable + auto-pick + 3 个新单测
> - ⏳ **Future (separate PR)**: 6 平台 SSE fallback + 中文 i18n
>
> **Test command**:
> ```bash
> .venv/bin/python -m pytest tests/test_crawler_dy_run_async_gen.py -v
> ```
>
> **See also**:
> - `openspec/changes/crawler-search-stream/proposal.md` — Why / What / Impact / Acceptance Criteria
> - `openspec/changes/crawler-search-stream/specs/search-stream/spec.md` — delta-format 合约（3 requirements / 10 scenarios）

## 1. 后端 — aclose race 修复 (in `70508319`)

- [x] 1.1 `crawler/platforms/douyin/core.py::_run_async_gen` 的 `finally` 块：在已有的 `gen.aclose()` try/except **之后**，给 `loop.close()` 也包一个对称的 `try/except Exception`（debug 级别日志）。**1 行行为变更**。
- [x] 1.2 2 行注释说明 Py 3.12+ auto-asyncgen-sweep race（"same race as gen.aclose() above; see test docstring for full failure mode"），避免下一个 contributor "fix" 回去。
- [x] 1.3 新增 `tests/test_crawler_dy_run_async_gen.py::test_run_async_gen_loop_close_aclose_attribute_error_is_swallowed`：monkeypatch `BaseEventLoop.close` 让它抛出生产环境完全一致的 `AttributeError("'Browser' object has no attribute 'aclose'")`（verbatim message），断言 (a) `sync_stream.close()` 不传播 AttributeError，(b) 持有的 fake Browser 在 exploding close 之前已经被 explicit aclose 关掉。**这个测试在没有修复时会 fail**。
- [x] 1.4 文件头 docstring 更新：`_run_async_gen` 的 docstring 解释 "Explicit asyncgen aclose BEFORE loop.close()"（生产失败模式 + 修复策略 + Py 3.12+ 行为）— 12 行注释块。
- [x] 1.5 `scripts/manual_dy_search_diag.py` 调试脚本同步 (配合新行为)。

## 2. OpenSpec — Delta-format spec 落地 (in `70508319`)

- [x] 2.1 `specs/search-stream/spec.md` — 3 requirements：
  - `### Requirement: SSE error contract on missing or invalid account` (4 scenarios: 401 omitted / 401 empty string / 400 not_found / 200 valid)
  - `### Requirement: Asyncgen cleanup sequencing before loop.close()` (3 scenarios: explicit aclose before close / loop.close AttributeError swallowed / SSE disconnect cleanup)
  - `### Requirement: SSE concurrency limit via semaphore` (4 scenarios: acquire before launch / release on success / release on exception / env override)
  - 共 11 scenarios（每 requirement 3-4 个 GIVEN/WHEN/THEN）
- [x] 2.2 `_index.json` 元数据（`id: "crawler-search-stream"` / `title` / `status: "in-progress"` / 引用 `proposal.md` + `tasks.md` + `specs/search-stream/spec.md`）
- [x] 2.3 `proposal.md` — Why（2 个问题）/ What Changes（7 行 table，标 ✅/⏳ 区分 in-commit vs separate）/ Impact（7 个 affected files）/ Acceptance Criteria（4 条，含 2 ✅ + 2 ⏳）
- [x] 2.4 `openspec validate crawler-search-stream` 通过（delta-format 0 失败）— 依赖 openspec CLI 环境

## 3. 401 修复 — Uncommitted (separate commit, NOT in `70508319`)

> 以下列出来为了 spec.md 是完整的 SSE 错误合约，但代码改动在另一个 commit。

- [ ] 3.1 `web_runner/routes/crawl.py::crawl_search_stream` 顶部新增 401 检查：empty / missing `account_group_name` 时立即返回 `401 {success: false, code: "missing_account", message, redirect_url: "/app/accounts"}` 而非启动 15s 超时。
- [ ] 3.2 已有 400 `account_not_found` 也补上 `code: "account_not_found"` + `redirect_url: "/app/accounts"`。
- [ ] 3.3 5 行注释块说明 production failure mode（15s 静默超时 + 混乱的 "cookie 校验非 race 异常" 警告）。
- [ ] 3.4 `sau_web/frontend/src/Pages/CrawlPage.tsx::canSubmit` 检查新增 `&& (kind !== 'search' || selectedAccount.length > 0)` — search 模式下没选账号时按钮 disabled。
- [ ] 3.5 `CrawlPage.tsx` 新增 useEffect：平台切换 + 账号列表刷新时 auto-pick `availableAccounts[0].groupName`（kind === 'search'）。Deps `[platform, availableAccounts]`（不含 `kind`）。
- [ ] 3.6 `CrawlPage.tsx` 账号下拉：搜索模式下隐藏 "自动（不使用保存的 Cookie）" option。
- [ ] 3.7 `sau_web/frontend/src/api/sse.ts::case 'error':` 加 6 行 TODO：检测 `code === "missing_account"` 后 emit 中文提示。
- [ ] 3.8 `tests/test_crawl_api.py::TestCrawlSearchStream` 新增 `test_search_stream_missing_account_returns_401` + 更新 3 个已有 SSE 测试（`_resolve_account_file` mock）+ 更新 concurrency 测试（SlowCrawler 加 `__init__`）。
- [ ] 3.9 `web_runner/routes/crawl.py::crawl_search_stream` docstring 末尾新增 9 行 TODO：6 平台缺 `search_stream()` 方法，AttributeError 兜底成 `event: error`；推荐方案 A（promote `_run_async_gen` 到 base）。

## 4. Future Followups (separate PRs, NOT in `70508319`)

- [ ] 4.1 6 平台 SSE fallback：方案 A — promote `_run_async_gen` 到 `crawler/base/base_crawler.py::AbstractCrawler` + 加默认 `search_stream(keyword, *, max_count, page_num): yield from self.search(...)`（批量回退）。6/7 平台零成本获得 streaming；douyin 保留它自己的 override（真逐行流式）。
- [ ] 4.2 本地化 401 错误为中文：sse.ts 检测 `data.code === "missing_account"`，emit 「请先到 /app/accounts 添加授权账号」；同步处理 `code === "account_not_found"`。新增 vitest 测试锁住链路。
- [ ] 4.3 `/api/crawl/search`（task-queue 模式，不是 SSE）也加同样的 missing_account 校验 — 当前 task 直接进 queue 后 15s 超时，silent fail 同 SSE 路径。
- [ ] 4.4 openspec baseline ratchet：本 change 新建不消耗 stub；等 4.1 落地时把 `crawler-core` stub 升级成 delta-format 同时 decrement `docs/openspec-stub-baseline.txt` by 1。
