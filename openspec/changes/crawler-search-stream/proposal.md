# crawler-search-stream — SSE 错误合约 + 异步生成器 teardown 竞态修复

## Why

`POST /api/crawl/search-stream` (`web_runner/routes/crawl.py::crawl_search_stream`)
是 crawl 模块的实时入口，对接 `/dashboard/crawl` 页面。round-OPT-async-202
从 background task queue 改成 SSE 同步流式之后，2 个独立问题没有 openspec
锁定：

1. **Py 3.12+ auto-asyncgen-sweep 竞态**（提交 `70508319` 修复）：
   `crawler/platforms/douyin/core.py::_run_async_gen` 的 `finally` 块在
   `loop.close()` 时触发 `'Browser' object has no attribute 'aclose'`
   （patchright 的 `Browser` 只有 `close()` 没有 `aclose()`，但 Python 3.12+
   在 `loop.close()` 里自动对所有 pending asyncgen 调 `aclose()`）。异常
   被 SSE 路由的 `except Exception` 接住后变成 `event: error` 推给浏览器，
   即使数据已经成功流式完成 — 假阳性错误，影响产品信任。

2. **SSE 错误合约无 openspec 锁定**（本 change 提交 spec.md）：
   `event: error` 的 emit 规则 + 401 missing_account 的 `code: redirect_url`
   形状都靠 `web_runner/routes/crawl.py` 注释 + 测试夹具来维护，没有
   openspec 权威来源。后续要改 401 行为时无法 grep 一个 spec 锁定。

## What Changes

| 改动 | 状态 | 来源 commit / PR |
| --- | --- | --- |
| `crawler/platforms/douyin/core.py::_run_async_gen` 给 `loop.close()` 包 try/except（1 行行为变更） | ✅ done | `70508319`（本 commit amend） |
| 1 个 lock-in 单测 `test_run_async_gen_loop_close_aclose_attribute_error_is_swallowed` | ✅ done | `70508319` |
| `scripts/manual_dy_search_diag.py` 调试脚本同步 | ✅ done | `70508319` |
| delta-format `specs/search-stream/spec.md`（3 requirements / 11 scenarios） | ✅ done | `70508319`（本 commit amend） |
| SSE 401 `code: missing_account` 合约 + 前端 button disable + auto-pick | 🟡 code written, uncommitted | **未在 70508319**：working tree uncommitted，separate commit（不本 amend 范围）|
| 6 平台 SSE fallback（promote `_run_async_gen` 到 base + default `search_stream`） | ⏳ future | separate PR |
| 本地化 401 错误为中文（sse.ts 检测 `code === "missing_account"`） | ⏳ future | separate PR |

## Impact

**本 commit（`70508319`）影响的 files：**
- `crawler/platforms/douyin/core.py` — 1 行行为变更（`loop.close()` 包 try/except）+ 12 行 docstring
- `tests/test_crawler_dy_run_async_gen.py` — 新增 1 个 lock-in 测试
- `scripts/manual_dy_search_diag.py` — 调试脚本同步
- `openspec/changes/crawler-search-stream/_index.json` — 新建 change 元数据
- `openspec/changes/crawler-search-stream/proposal.md` — 本文件
- `openspec/changes/crawler-search-stream/tasks.md` — 任务清单
- `openspec/changes/crawler-search-stream/specs/search-stream/spec.md` — delta-format 合约

**新 specs**：`openspec/changes/crawler-search-stream/specs/search-stream/spec.md`
- 3 requirements：
  1. `SSE error contract on missing or invalid account` — 401/400 形状 + `code` + `redirect_url`
  2. `Asyncgen cleanup sequencing before loop.close()` — explicit aclose + loop.close 异常 swallow
  3. `SSE concurrency limit via semaphore` — `SAU_STREAM_CONCURRENCY` env + 429
- 11 scenarios（每 requirement 3-4 个 GIVEN/WHEN/THEN）

**不影响 openspec stub baseline**（`docs/openspec-stub-baseline.txt = 49`）：这是新建 change，不是 backfill。401 修复完成时 + 6 平台 fallback 完成时再 backfill 关联 stub 同步 decrement baseline。

## Acceptance Criteria

1. ✅ `pytest tests/test_crawler_dy_run_async_gen.py -v` → 全部 passing，包括新的
   `test_run_async_gen_loop_close_aclose_attribute_error_is_swallowed`（**没有修复会 fail**，
   因为 `loop.close()` 会 propagate `AttributeError`）
2. ⏳ `pytest tests/test_crawl_api.py -v` → 全部 passing — **不在 70508319 范围**，
   在 401 修复的 separate commit 里（AC 独立锁定 401 合约）
3. ✅ `openspec validate crawler-search-stream` 通过 — 3 requirements / 10 scenarios
   都是合法 GIVEN/WHEN/THEN
4. ✅ TypeScript 编译 clean — **不在 70508319 范围**（CrawlPage.tsx 的 401 修复
   单独 commit；本 PR 只动 backend + openspec + 测试）

## Test command

```bash
# Run the lock-in test for this commit
.venv/bin/python -m pytest tests/test_crawler_dy_run_async_gen.py -v

# OpenSpec structure validation (if openspec CLI is available)
openspec validate crawler-search-stream
```
