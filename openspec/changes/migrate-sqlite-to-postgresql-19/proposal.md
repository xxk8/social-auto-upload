## Why

`social-auto-upload` 的 Web 后端 (`web_runner.py` + 包) 当前使用本地 SQLite (`db/database.db`) 作为持久层。SQLite 已经在多个真实场景下出现瓶颈与隐性 BUG，并且单进程 Flask 内堆积了三份重复的入口文件，使得任何持久层的演进都需要重写三遍：

1. **并发瓶颈** — `db_lock = threading.Lock()` 在所有写入路径上加全局互斥锁，导致 8 个后台 worker + 5 个 SSE 客户端的实际吞吐 ≪ PG MVCC 下的自然并发。`/api/tasks`、`/api/logs` 在上传高峰期被阻塞数百毫秒。
2. **日志表修剪 BUG** — `web_runner.py:444` 用 `rowid NOT IN (...) ORDER BY ts DESC`，而 `web_runner/utils.py:121` 用 `ts NOT IN (...) ORDER BY ts DESC`。两文件实现不一致；且 `ts` 是 `TEXT`，应用层每 50-200 次 insert 触发一次 DELETE，期间是 full scan + commit。
3. **JSON 列无法索引** — `tasks.argv` / `tasks.result` / `tasks.publish_detail` 都以 `JSON TEXT` 存储，PG 的 `JSONB` 配合 GIN 索引能直接服务 `argv->>'account'` 与 `?` 占位符查询；同时当前代码不查询它们，等于白白丢失索引机会。
4. **`LIKE '%task_id%'` 全表扫描** — `_db_get_logs(task_id=...)` 用前导通配符，SQLite B-tree 与 PG 都无法走索引。日志量过万后这条接口单次响应可达数秒。
5. **重复入口** — `web_runner.py`（1332 行）、`web_runner_legacy.py`（1332 行）、`routes/ai.py`（~600 行）三份代码并存，三份都直接 `sqlite3.connect()`。任何 PG 迁移要在三处同步改写 `?` → `%s`、加 `RETURNING id`、换 row_factory，永远会漏。
6. **没有连接池** — 每次 HTTP 请求/SSE 都 `with sqlite3.connect(DB_PATH) as conn:` 开新连接，PG 时代换 TCP + TLS，开销放大数十倍，必须用 `psycopg_pool.ConnectionPool`。

迁移到 PostgreSQL 19 不是「换个驱动」的小事，而是一次把写入路径、并发模型、日志/任务表索引策略、正则查询一并修好的机会。

## What Changes

**D1：持久层驱动迁移**
- 新增依赖：`psycopg[binary]==3.2.*`、`psycopg-pool==3.2.*`、`alembic==1.13.*`（dev）
- 在 `web_runner/db.py` 引入 `Database` 抽象，对外暴露 `execute()`、`execute_many()`、`fetch_one()`、`fetch_all()`，内部根据 `SAU_DB_DIALECT` 选择 SQLite (legacy) 与 PostgreSQL 实现
- 引入 `psycopg_pool.ConnectionPool`，min=2 max=15，autocommit=True
- 占位符自动转换：`?` → dialect-aware（PG → `%s`），唯一编码点

**D2：Schema 升级 + JSONB + 新索引**
- 7 张表全部重建为 PG 19 推荐类型（详见 design.md §Tables）
- `tasks.argv` / `tasks.result` / `tasks.publish_detail` / `error_events.argv` → `JSONB`
- `logs` 新增 `id BIGSERIAL PRIMARY KEY`，trim 用 `id < cutoff` 替代 `NOT IN`
- `logs.message` 加 `GIN (message gin_trgm_ops)` 索引（启用 `pg_trgm` 扩展），让 `LIKE '[<task_id>]%'` 能走索引；同时**修复**应用层正则查询为前缀匹配
- 新增 `idx_tasks_status_created (status, created DESC)`、`idx_tasks_platform_action (platform, action)`、`idx_logs_task_id_prefix` 表达式索引
- `tasks.status` 加 `CHECK IN ('pending','running','success','failed','error','scheduled')`

**D3：移除 db_lock 与 PSI 副作用**
- 删除 `db_lock = threading.Lock()`（PG MVCC 接管）
- 保留 `_timer_lock`、`_progress_sub_lock`、`_ai_queue_lock`（这些守护 Python 内存结构，不守护 DB）
- 新增 `pool stats` 监控 endpoint（只读 PG version 13+ 的 `pg_stat_activity`，不泄露凭据）

**D4：清理 legacy 重复入口**（必须在任何 PG 工作之前完成）
- 删除 `web_runner.py`（1332 行）
- 删除 `web_runner_legacy.py`（1332 行）
- 删除 `routes/ai.py`（~600 行）
- 主入口全部走 `web_runner/__init__.py::create_app()`

**D5：离线数据迁移器**
- 新增 `db/migrate_sqlite_to_pg.py` one-shot 脚本：BATCH=500 通过 `executemany` 推送
- 自动校验行数 + 抽样 100 行 hash 校验 argv/result JSON 序列化是否一致
- 写入 PG `migration_audit` 表记录源/目标 rowcount 与 hash（事后可 SQL 复核）

**D6：测试基础设施**
- `tests/conftest.py` 不再 `patch('sqlite3.connect')`，改为按测试标记 (sqlite/pg) 动态连接
- 新增 `tests/integration/` 跑真实 PG（推荐 `testcontainers-python` 或本地 `pg_ctl`-managed 临时实例）
- 单元测试可继续 SQLite（跑纯算法函数、CLI dispatch、UI state machine）

**D7：观测与运维**
- 新增 `/api/health/db` endpoint（返回 pool stats、pg version、vacuum 状态、active connections）
- 新增 `pg_dump` 每日 cron 文档到 `docs/ops/postgres-backup.md`
- 安装侧 `Dockerfile` 增加 `libpq-dev` 与 `psycopg-binary` wheel 兼容说明
- `pyproject.toml` 新增 `web-pg = ["psycopg[binary]", "psycopg-pool"]` extra

## Capabilities

### New Capabilities

- `pg-database-driver`: psycopg 3 sync 驱动 + ConnectionPool + dialect-aware execute wrapper
- `pg-schema-v19`: 7 张表的 PG 19 schema 定义 + Alembic baseline migration，包含 JSONB、BRIN、Trigram GIN 索引、CHECK constraint
- `sqlite-pg-migrator`: 离线一次性数据迁移脚本 + 校验 + audit 表
- `db-pool-observability`: `/api/health/db` endpoint、pool stats、日志、慢查询告警钩子

### Modified Capabilities

- `web-runner-entrypoint`: 仅 `web_runner/__init__.py` 是入口；删除 3 个 legacy 重复文件
- `task-storage`: `tasks.argv`/`result`/`publish_detail` 改为 JSONB；新增 status/created 复合索引与 CHECK
- `log-storage`: `logs.id BIGSERIAL PRIMARY KEY`；trim 改 `id < cutoff`；message 改 Trigram GIN
- `error-event-storage`: `error_events.argv` 改 JSONB；traceback 保持 TEXT 不变
- `concurrency-model`: 删除 `db_lock`，依赖 PG MVCC；保留 Python 进程内锁

## Impact

**受影响文件**
- `db/createTable.py` → 退役（保留作为历史文档），实际建表由脚本 + Alembic 接管
- `web_runner.py` → **删除**（Cutover PR1）
- `web_runner_legacy.py` → **删除**（Cutover PR1）
- `routes/ai.py`（顶层） → **删除**（Cutover PR1）
- `web_runner/db.py` → 重写为 `Database` 抽象 + ConnectionPool + SQL wrapper
- `web_runner/utils.py` → 7 个 `_db_*` 函数改为通过 wrapper 执行；保留函数签名
- `web_runner/routes/*.py` → 几乎不变（`db.py` 接口兼容），但 model 层的 JSON 字段可直接 dict-in / dict-out 而非 `json.dumps(string)`
- `web_runner/__init__.py` → 不变
- `pyproject.toml` → `[web-pg]` extra
- `Dockerfile`、`docs/install.md` → 增加 PG 客户端依赖
- `tests/conftest.py`、`tests/test_sau_web_*.py` → 适配新 conftest；新增 `tests/integration/`
- `openspec/config.yaml` → 改「Tech stack」一行：Flask + PostgreSQL 19（保留 SQLite 作为 dev fallback）

**CLI/API/Frontend 三层影响**
- CLI: **`受影响`** — `cli/main.py` 与 `cli/dispatchers.py` 当前不直接访问 DB，但 `uploader/common.py` 与各 uploader 旁路读取 cookies/数据库的地方需要确认；清查后无直接调用，仅文档注释里提到 `web_runner`，更新文字
- Web API: **`主要变更`** — driver/schema/concurrency 全部重写；HTTP 接口契约 (`/api/...`) 100% 不变，前端无需感知
- Frontend: **`无影响`** — 前端只调 HTTP 接口；DB 切换是后端内部事务。`sau_web/frontend/src/api/client.ts` 不需改动；axios retry、tanstack query、optimistic update 全部继续工作
