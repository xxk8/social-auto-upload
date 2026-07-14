# crawler-search-stream — SSE 错误合约 + 异步生成器 teardown 竞态修复

> **Status**:
> - ✅ **Committed (`cea1d784`, `d6f2c140`, `3c06d8a7`)**: aclose race 修复 + 1 个 lock-in 测试 + 调试脚本同步 + delta-format spec
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

## 1. 后端 — aclose race 修复 (in `cea1d784`)

- [x] 1.1 `crawler/platforms/douyin/core.py::_run_async_gen` 的 `finally` 块：在已有的 `gen.aclose()` try/except **之后**，给 `loop.close()` 也包一个对称的 `try/except Exception`（debug 级别日志）。**1 行行为变更**。
- [x] 1.2 2 行注释说明 Py 3.12+ auto-asyncgen-sweep race（"same race as gen.aclose() above; see test docstring for full failure mode"），避免下一个 contributor "fix" 回去。
- [x] 1.3 新增 `tests/test_crawler_dy_run_async_gen.py::test_run_async_gen_loop_close_aclose_attribute_error_is_swallowed`：monkeypatch `BaseEventLoop.close` 让它抛出生产环境完全一致的 `AttributeError("'Browser' object has no attribute 'aclose'")`（verbatim message），断言 (a) `sync_stream.close()` 不传播 AttributeError，(b) 持有的 fake Browser 在 exploding close 之前已经被 explicit aclose 关掉。**这个测试在没有修复时会 fail**。
- [x] 1.4 文件头 docstring 更新：`_run_async_gen` 的 docstring 解释 "Explicit asyncgen aclose BEFORE loop.close()"（生产失败模式 + 修复策略 + Py 3.12+ 行为）— 12 行注释块。
- [x] 1.5 `scripts/manual_dy_search_diag.py` 调试脚本同步 (配合新行为)。

## 2. OpenSpec — Delta-format spec 落地 (in `3c06d8a7`)

- [x] 2.1 `specs/search-stream/spec.md` — 3 requirements：
  - `### Requirement: SSE error contract on missing or invalid account` (4 scenarios: 401 omitted / 401 empty string / 400 not_found / 200 valid)
  - `### Requirement: Asyncgen cleanup sequencing before loop.close()` (3 scenarios: explicit aclose before close / loop.close AttributeError swallowed / SSE disconnect cleanup)
  - `### Requirement: SSE concurrency limit via semaphore` (4 scenarios: acquire before launch / release on success / release on exception / env override)
  - 共 11 scenarios（每 requirement 3-4 个 GIVEN/WHEN/THEN）
- [x] 2.2 `_index.json` 元数据（`id: "crawler-search-stream"` / `title` / `status: "in-progress"` / 引用 `proposal.md` + `tasks.md` + `specs/search-stream/spec.md`）
- [x] 2.3 `proposal.md` — Why（2 个问题）/ What Changes（7 行 table，标 ✅/⏳ 区分 in-commit vs separate）/ Impact（7 个 affected files）/ Acceptance Criteria（4 条，含 2 ✅ + 2 ⏳）
- [x] 2.4 `openspec validate crawler-search-stream` 通过（delta-format 0 失败）— 依赖 openspec CLI 环境

## 3. 401 修复 — Committed (commit `8ccbc559`, on top of `cea1d784`)

> 代码改动在 commit `8ccbc559` (4 files: `web_runner/routes/crawl.py` + `CrawlPage.tsx` + `test_crawl_api.py` + `sse.ts`)。
> Spec.md 的 SSE 错误合约 section 仍然适用 (3 requirements / 11 scenarios)。

- [x] 3.1 `web_runner/routes/crawl.py::crawl_search_stream` 顶部新增 401 检查：empty / missing `account_group_name` 时立即返回 `401 {success: false, code: "missing_account", message, redirect_url: "/app/accounts"}` 而非启动 15s 超时。
- [x] 3.2 已有 400 `account_not_found` 也补上 `code: "account_not_found"` + `redirect_url: "/app/accounts"`。
- [x] 3.3 5 行注释块说明 production failure mode（15s 静默超时 + 混乱的 "cookie 校验非 race 异常" 警告）。
- [x] 3.4 `sau_web/frontend/src/Pages/CrawlPage.tsx::canSubmit` 检查新增 `&& (kind !== 'search' || selectedAccount.length > 0)` — search 模式下没选账号时按钮 disabled。
- [x] 3.5 `CrawlPage.tsx` 新增 useEffect：平台切换 + 账号列表刷新时 auto-pick `availableAccounts[0].groupName`（kind === 'search'）。Deps `[platform, availableAccounts]`（不含 `kind`），`// eslint-disable-next-line react-hooks/exhaustive-deps` 文档化 `kind` 故意排除（避免 "user picks B → 切到 detail → 切回 search 被覆盖成 A" 的 UX 陷阱）。
- [x] 3.6 `CrawlPage.tsx` 账号下拉：搜索模式下隐藏 "自动（不使用保存的 Cookie）" option。
- [x] 3.7 `sau_web/frontend/src/api/sse.ts::case 'error':` 加 6 行 TODO：检测 `code === "missing_account"` 后 emit 中文提示。
- [x] 3.8 `tests/test_crawl_api.py::TestCrawlSearchStream` 新增 `test_search_stream_missing_account_returns_401` + 更新 3 个已有 SSE 测试（`_resolve_account_file` mock）+ 更新 concurrency 测试（SlowCrawler 加 `__init__`）。
- [x] 3.9 `web_runner/routes/crawl.py::crawl_search_stream` docstring 末尾新增 9 行 TODO：6 平台缺 `search_stream()` 方法，AttributeError 兜底成 `event: error`；推荐方案 A（promote `_run_async_gen` 到 base）。

## 4. Future Followups (separate PRs)

- [x] 4.1 6 平台 SSE fallback — **发现**：`AbstractCrawler.search_stream` 默认实现 (`crawler/base/base_crawler.py:89-98`) **已存在** (`yield from self.search(...)`)，6/7 平台通过继承零成本获得 streaming。上一轮 audit 的 "6 平台 AttributeError" 是 outdated info。**本 round 加了锁住合约的 3 个测试** (`tests/test_crawler.py::TestAbstractCrawlerSubcontract`):
      - `test_search_stream_default_yields_from_search` — base 默认走 `yield from self.search(...)`
      - `test_six_non_douyin_platforms_inherit_search_stream` — 6 平台 MUST 继承 base（不 override）
      - `test_douyin_overrides_search_stream` — DouyinCrawler 仍 override（真逐行流式）
      - 同时更新了 `web_runner/routes/crawl.py::crawl_search_stream` docstring 里 stale 的 5 行 TODO (改成 "Note: ... out-of-the-box via inheritance")
- [ ] 4.2 本地化 401 错误为中文：sse.ts 检测 `data.code === "missing_account"`，emit 「请先到 /app/accounts 添加授权账号」；同步处理 `code === "account_not_found"`。新增 vitest 测试锁住链路。
- [ ] 4.3 `/api/crawl/search`（task-queue 模式，不是 SSE）也加同样的 missing_account 校验 — 当前 task 直接进 queue 后 15s 超时，silent fail 同 SSE 路径。
- [ ] **4.4 [FUTURE — multi-month, separate openspec change]** 真正的后续 unblock：实现 6 平台的 `search()` 方法（当前返回空 stub `_not_implemented_log`）。这不是 SSE fallback 问题（fallback 合约已锁），而是 "点搜索拿到空结果" 问题。范围是 Playwright DOM 拼装 + selector chains + 各国千变 selector 维护，对应原计划 Tasks 5.1–5.4。预估 3-6 人月（6 平台 × 选 Playwright + 反爬 + cookie flow + selector 维护），不是 quick fix。
- [ ] 4.5 openspec baseline ratchet：本 change 新建不消耗 stub；等 4.4 落地时把 `crawler-core` stub 升级成 delta-format 同时 decrement `docs/openspec-stub-baseline.txt` by 1。
