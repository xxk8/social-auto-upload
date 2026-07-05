## Context

`social-auto-upload` 当前 Web 后端持久层是 SQLite：

- 数据库：仓库内的 `db/database.db`（被 `.gitignore` 排除）
- 入口：单进程 Flask，有三份重复的入口文件 `web_runner.py`、`web_runner_legacy.py`、`routes/ai.py`
- Schema（见 `web_runner/db.py`）：7 张表，`tasks` / `logs` / `account_groups` / `account_authorizations` / `ai_config` / `ai_api_keys` / `error_events`
- 持久层代码风格：raw `sqlite3.connect()`，`?` 占位符，`conn.row_factory = sqlite3.Row`，手写 ALTER TABLE 迁移
- 并发：所有写操作通过 `web_runner.db.db_lock` 互斥；`task_executor` 8 worker + SSE 5 客户端共享同一 Flask 进程
- 查询侧问题：`_db_get_logs(task_id=...)` 用 `LIKE '%<task_id>%'` 前导通配符全表扫；`_db_insert_log` trim 用 `ts NOT IN` 在 ts 重复时错删
- 测试：`tests/conftest.py` 全局 patch `sqlite3.connect`，所以现有测试从未跑过真实 SQLite 之外的数据库

目标迁移到 PostgreSQL 19（与项目 `requires-python = ">=3.10,<3.13"` 兼容；psycopg-binary 3.2 支持 Linux/macOS/Windows wheel）。

## Goals / Non-Goals

**Goals**
- Web HTTP 接口 contract **零变化**（前端 `sau_web/frontend` 无任何改动）
- 写入吞吐显著提升（移除 `db_lock`，依赖 PG MVCC）
- 修复三处已识别的 SQL 异味（`LIKE` 通配符、`ts NOT IN` 修剪、`tasks` 复合索引缺失）
- 给 logs/tasks 提供真正可查询的索引（Trigram GIN、JSONB GIN、CHECK constraint）
- 保持单元测试能在 SQLite 上跑（dev 模式 fallback）；新增集成测试覆盖 PG 行为
- 一个 epoch-marker 离线迁移脚本 + audit 校验
- 维护一个 5 天回滚窗口（cutover 后保留 SQLite 文件做 read-only archive）

**Non-Goals**
- 不改变 CLI 入口（`sau <platform> <action>` 保持不变）
- 不改造 SSE 协议
- 不引入 ORM（不引入 SQLAlchemy、Peewee、Tortoise），保持 raw SQL — 改造面更可控
- 不引入 Pydantic/dict 类型化（项目惯例是 dataclass，不引入新依赖）
- 不实施水平分片 / 读写分离 / 多实例 Flask（项目是单用户桌面级工具）
- 不立即移除 SQLite 代码路径（前 2 周保留 `SAU_DB_DIALECT=sqlite` flag 做兜底）

## Decisions

### D1 — Driver 选型：psycopg 3 sync

**决策**: 使用 `psycopg[binary]==3.2.*`、`psycopg-pool==3.2.*` 同步 API。

**为什么**:
- Flask 3 + 全程 `task_executor.submit()` 都是同步线程，引入 async 反而增加复杂度
- psycopg 3 的 row factory `dict_row` 类比 `sqlite3.Row`，迁移心智成本最低
- `psycopg-pool` 内置 retry on broken connection，适配长时间运行的 SSE 后台 worker
- 没有引入 SQLAlchemy 的动机：项目是 raw SQL + 简单字符串拼接，无模型定义，无 mapper，省掉 ORM = 省掉 ~1MB 依赖与一张抽象税

**替代方案——SQLAlchemy 2.0**:
- 优势：mypy 集成、`Mapped[...]` 静态安全
- 劣势：现有代码是 raw SQL，需要 7 个表的 ORM 模型 + Alembic init，所有路径改写，迁移工作量翻 3-5 倍；项目体量无需 ORM 的工程化收益
- 决策：**拒绝**

**替代方案——psycopg 3 async + aiohttp**:
- 优势：SSE 长连接更优雅
- 劣势：当前 Flask 3.1 路由都是 `def`（不是 `async def`），混 async 改造整套 routing 不可接受
- 决策：**拒绝**

### D2 — Dialect-aware `execute()` wrapper

**决策**: 在 `web_runner/db.py` 暴露一个统一入口：

```python
class Database:
    def execute(self, sql: str, params: tuple = ()) -> Cursor: ...
    def execute_many(self, sql: str, seq_of_params: list[tuple]) -> None: ...
    def fetch_one(self, sql: str, params: tuple = ()) -> dict | None: ...
    def fetch_all(self, sql: str, params: tuple = ()) -> list[dict]: ...
    def last_insert_id(self, cur: Cursor) -> int: ...  # PG: RETURNING id; SQLite: lastrowid
```

Wrapper 内部：
- 检测 `SAU_DB_DIALECT`（默认：`postgres`）
- 当 dialect=postgres 时，把 SQL 字符串里的 `?` 全部替换为 `%s`（仅参数占位符；转义 `?` 字符串字面量请用 `\\?` 或参数化）
- cursor row_factory 统一为 dict-like
- 在 `last_insert_id` 自动拼 `RETURNING id`（PG）`PRAGMA last_insert_rowid()` 都不需要，应用层不感知

**为什么**:
- 应用层 200+ 处 `_db_*` 函数只需把 `conn.execute("...?", (...,))` 改为 `db.execute("...?", (...,))`，语义零变化
- 单元测试可以指定 `SAU_DB_DIALECT=sqlite` 继续跑 SQLite，未必所有 dev 都有 PG
- 提供一条平滑的回退通道

**风险**: `?` → `%s` 替换如果误伤 LIKE 字面量里的 `?`（目前代码无此用法）。后续 PR 增加 lint 规则禁止 raw LIKE `?`。

### D3 — Schema 升级（详见下方 Tables）

每个表单独列出：

#### `tasks`
- `task_id TEXT PRIMARY KEY` (不变 — 应用层生成的字符串 ID)
- `status TEXT NOT NULL DEFAULT 'pending'` + `CHECK (status IN ('pending','running','success','failed','error','scheduled'))`
- `platform TEXT`、`action TEXT`、`account TEXT`
- `created TIMESTAMPTZ NOT NULL`（原 `TEXT`，PG 解析 ISO8601 自动转时区）
- `code INTEGER`、`error TEXT`
- `argv JSONB`、`result JSONB`、`publish_detail JSONB`（原 TEXT，应用层去 `json.dumps/loads`）

#### `logs`
- `id BIGSERIAL PRIMARY KEY` ← **新增**（修 trim BUG 的关键）
- `ts TIMESTAMPTZ NOT NULL`
- `message TEXT NOT NULL`
- 索引：
  - `idx_logs_brin_ts ON logs USING BRIN (ts)` — 时序插入日志自然有序，BRIN 占空间小
  - `idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops)` — pg_trgm 启用后生效
- 修剪：`DELETE FROM logs WHERE id < (SELECT id FROM logs ORDER BY id DESC OFFSET 10000 LIMIT 1)` — 单条 ctid 操作，毫秒级

#### `account_groups`
- `id BIGSERIAL PRIMARY KEY`（原 INTEGER）
- `name TEXT NOT NULL UNIQUE`
- `created TIMESTAMPTZ NOT NULL`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `idx_account_groups_sort ON account_groups (sort_order ASC)`

#### `account_authorizations`
- `id BIGSERIAL PRIMARY KEY`
- `group_id BIGINT NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE`
- `platform TEXT NOT NULL`
- `cookie_file TEXT NOT NULL`
- `created TIMESTAMPTZ NOT NULL`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `UNIQUE (group_id, platform)`
- `idx_aa_group_id_sort ON account_authorizations (group_id, sort_order)`

#### `ai_config`
- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `updated TIMESTAMPTZ NOT NULL`

#### `ai_api_keys`
- `id BIGSERIAL PRIMARY KEY`
- `api_key TEXT NOT NULL UNIQUE`
- `masked TEXT NOT NULL`
- `created TIMESTAMPTZ NOT NULL`
- `rate_limited_at TIMESTAMPTZ`

#### `error_events`
- `id BIGSERIAL PRIMARY KEY`
- `ts TIMESTAMPTZ NOT NULL`
- `task_id TEXT`
- `level TEXT NOT NULL DEFAULT 'error'`
- `phase TEXT NOT NULL`
- `platform TEXT`、`account TEXT`、`action TEXT`
- `exc_type TEXT`、`exc_message TEXT`、`traceback TEXT`
- `argv JSONB`（原 TEXT）
- `attempt_no INTEGER`、`retry_count INTEGER`、`status_code INTEGER`
- 索引：`idx_error_events_ts`、`idx_error_events_platform`、`idx_error_events_account`、`idx_error_events_exc_type`

#### `migration_audit`（新增）
- `id BIGSERIAL PRIMARY KEY`
- `migrated_at TIMESTAMPTZ NOT NULL`
- `table_name TEXT NOT NULL`
- `source_count INTEGER NOT NULL`
- `target_count INTEGER NOT NULL`
- `sample_hash TEXT` — 抽样 100 行的 SHA-256 之和
- `dialect TEXT NOT NULL`

**扩展**:
- `pg_trgm` 启用：`CREATE EXTENSION IF NOT EXISTS pg_trgm`（Alembic baseline 内）
- 不启用 `vector`、`pg_stat_statements` 等扩展；保留按需添加空间

### D4 — 并发模型变更

**决策**:
- 删除 `db_lock`、删除所有 `with db_lock:` 包裹
- ConnectionPool 复用连接，MVCC 让 SQLite 时代的 `database is locked` 问题不存在
- 进程内锁保留：
  - `_timer_lock` (`web_runner/utils.py`) — 守护 `_scheduled_timers` dict
  - `_progress_sub_lock` — 守护 `_progress_subscribers` dict
  - `_ai_queue_lock` — 守护 `_ai_queue_worker_started` flag

**为什么**:
- `db_lock` 是 SQLite 单文件跨连接的产物；PG 不需要
- 进程内锁守护的是 Python 对象，不是 DB 状态，必须留

### D5 — 切流策略：epoch-marker offline 迁移

**决策**: 一个 `db/migrate_sqlite_to_pg.py` one-shot：
1. 连 SQLite (`db/database.db`) 全表读取
2. 连 PG (`$DATABASE_URL`)
3. 每个表：BATCH=500，通过 `cursor.executemany(sql, rows)` 推送
4. 写完后 `SELECT count(*)` 双向比对
5. 抽样 100 行 hash 校验 `argv`/`result` 序列化序列化后字段一致
6. 写入 `migration_audit` 表
7. 退出码：0=Migration OK / 1=count mismatch / 2=hash mismatch / 3=other

切流步骤：
1. `systemctl stop sau-web` （或关闭本机 web_runner）
2. 修改 `.env`：`SAU_DB_DIALECT=postgres`、`DATABASE_URL=postgres://sau:***@localhost:5432/sau`
3. 运行 `uv run python db/migrate_sqlite_to_pg.py`
4. 启动 `web_runner`；Flask `/api/health/db` 返回 `{"dialect":"postgres"}` 即成功
5. **保留 SQLite 文件 14 天**做 read-only archive，置于仓库外部的 `archive/db-<epoch>/` 目录

**为什么不 dual-write**：单一 Flask 进程 + 单 SQLite 文件；双写需要事务一致性、双向 rsync、冲突解决；项目体量直接 cutover 风险更低、rollback 路径是「重启 + 改 env」。

**为什么不直接用 pgloader**：候选工具是 `pgloader`（业界 PG 迁移标准）。拒绝理由：(a) 它无法把 JSON TEXT 列在迁移期自动映射到 JSONB/类型识别，要求目标列已存在类型——本项目有 4 列需要 JSONB；先建空表再用 pgloader 灌，灌完还要 `ALTER ... USING jsonb_parse(...)`，脚本步骤并不会简化。(b) pgloader 的 BYPASS/REJECT/RATIO 容错策略对「数据正确性优先」的 _store_result 这类字段不友好（CLAUDE.md 注释明确一旦失败必须可见）— 错 1 行比直接抛异常更糟。(c) pgloader 是独立二进制工具，CI 重现性差，要 apt 安装。我们的自写脚本用项目自身的 `psycopg` + 测试过的 JSON parsing，结果更可控可审计。

### D6 — Cleanup-first：legacy 三文件必须在任何 PG 工作之前删掉

**决策**: PR1 是纯删除（无 PG 改动），后续 PR 才动 DB。

**为什么**:
- `?` → `%s` 与 `conn.row_factory` 替换如果要在三处改，diff 会非常巨大且易漏
- 三份 legacy 文件当前都在跑吗？不是 — `web_runner/__init__.py` 已 import `web_runner/routes/*`，所以 legacy 文件是 dead code（仍然在 import 路径上以兼容 import，PR1 删除前要 grep 确认无业务引用）
- 双重收益：删 3 个文件 ≈ 3500 行代码下架；后续 PR diff size 减半

**grep 验证**:
- 在 PR1 主体工作前运行 `git grep -l 'from web_runner_legacy\|from web_runner import\|from routes.ai'` 应为空
- 若发现 import，补迁路径后再删

### D7 — 测试双轨

**决策**:
- 单元测试（`tests/test_*.py`）：可继续 SQLite in-memory，通过 `SAU_DB_DIALECT=sqlite` env 强制
- 集成测试（新增 `tests/integration/`）：默认连真 PG，推荐 `testcontainers-python` 启动临时 PostgreSQL 19 容器
- `tests/conftest.py`：移除全局 patch `sqlite3.connect`，改为 fixture `db(request)` 根据 `pytest --db={sqlite,pg}` 提供连接

**为什么**:
- 现有 ~30 个 unit test 跑 SQLite < 2 秒；切换到 PG singleton 会把它们变成 ~30 秒
- 但 ops/model 边界（JSONB 解码、CHECK 报错、JSONB GIN 索引走法）必须 PG 真测

### D8 — Opportunist fixes（PG 切换一并修）

迁移机会内一并修：
- `_db_get_logs(task_id)`：`LIKE '%<id>%%'` → `message LIKE '[<id>]%'`（前缀）
- `_db_insert_log` trim：`ts NOT IN (SELECT ts ... ORDER BY ts DESC LIMIT N)` → `id < (SELECT id FROM logs ORDER BY id DESC OFFSET N LIMIT 1)`
- `_db_get_all_tasks` 历史的「两份实现不一致」（legacy `web_runner.py` 已随 PR1 删除并 snapshot 到 `legacy-snapshots/2026-06-24/`；当前唯一源在 `web_runner/utils.py:99`）— 维护一个干净实现：`ORDER BY created DESC, task_id DESC` + LIMIT/OFFSET
- `tasks.status` 一律 lowercase + CHECK constraint
- `tasks.argv` / `result` / `publish_detail` 不再做 `json.dumps`，数据库直接收 dict
- `error_events.argv` 同上
- SQLite 的 `text_factory` / `connection.text_factory` 设置不再需要；统一 PG 的 `set_client_encoding('UTF8')`
- 当 `SAU_DB_DIALECT=sqlite` (dev fallback) 时 JSONB 列仍是 TEXT，`json.dumps/loads` 保留使用；只有切到 `postgres` 才走 dict-in 的轻路径。Dialect-aware 包装层需提供 `dump(value)` / `load(value)` 两个 callable，让调用方按 dialect 选用。

## Risks / Trade-offs

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| 删 legacy 三文件破坏 import 路径 | 高 | PR1 先行 grep 验证；保留 1 周回退路径（git revert） |
| `?` → `%s` 替换误伤 LIKE 字面量 `?` | 中 | 当前代码扫描无 LIKE `?`；lint 规则禁止；CI grep 卡关 |
| ConnectionPool 太小导致 SSE 阻塞 | 中 | min=2 max=15；burst 测试覆盖；`/api/health/db` 暴露当前使用 |
| Alembic baseline 不匹配环境 | 中 | 提供 `alembic stamp head` 一键标记为最新；启动时引导 init |
| JSONB 解析时区漂移（TIMESTAMPTZ） | 低 | 全部统一 `datetime.now(timezone.utc)` |
| Trigram 索引 `pg_trgm` 未启用 | 低 | Alembic baseline 强 `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| Testcontainers 在 macOS CI 启动慢 | 中 | 集成测试默认为 nightly；单元测试默认 sqlite |
| SQLite → PG `text` 列内 `datetime.isoformat()` 字符串兼容性 | 中 | 迁移脚本中显式 `datetime.fromisoformat` 解析后 `TIMESTAMPTZ` 写入 |

## Migration Plan（五个 shippable PR）

### PR1: Delete legacy files（无 PG 工作，纯整理）
- 删除 `web_runner.py`、`web_runner_legacy.py`、`routes/ai.py`
- Grep 验证 `from web_runner_legacy` / `from web_runner import`（双引号） / `from routes.ai import`（顶层）零匹配
- 跑现有 `pytest tests/` 验证其他入口仍工作
- 受影响文件：3 个删除；其余不变
- Rollback：`git revert`

### PR2: Database abstraction + ConnectionPool（dialect=sqlite 与 dialect=postgres 都跑）
- `web_runner/db.py` 重写：新增 `Database`、`execute()` wrapper；保留 SQLite 路径
- `web_runner/utils.py`：`@db_lock` 删除；`with db_lock: conn.execute` → `with db.execute(...)`
- `SAU_DB_DIALECT=sqlite` 时走 SQLite，`SAU_DB_DIALECT=postgres` 走 PG
- 现有 200+ 调用站点功能不变（wrapper 同语义）
- 跑完整 `pytest tests/` 验证 SQLite dev 体验不变
- Rollback：`SAU_DB_DIALECT=sqlite` 是兜底，回退直接 env 切换

### PR3: Schema rewrite + Alembic baseline
- 新增 `pyproject.toml [web-pg]` extra
- `db/alembic/` baseline migration：6 张表重建为 PG schema + `pg_trgm` 扩展启用
- `db/migrate_sqlite_to_pg.py` 离线数据脚本
- `docs/ops/postgres-backup.md` 文档
- 跑 `web_runner` 在 `SAU_DB_DIALECT=postgres` 下启动；执行迁移脚本；hash 校验通过
- 受影响文件：`pyproject.toml`、`db/alembic/*`、`db/migrate_sqlite_to_pg.py`、`docs/ops/postgres-backup.md`
- Rollback：drop new database；切回 dialect=sqlite

### PR4: Opportunist fixes + observability
- `_db_get_logs` 改前缀匹配；`_db_insert_log` trim 改 id < cutoff；JSONB 收/发 dict
- `/api/health/db` endpoint
- 集成测试 `tests/integration/` 真 PG
- `pytest --db=pg` 跑全量集成
- Rollback：code-only revert

### PR5: Cutover + 14-day SQLite archive
- 整理 cutover checklist / runbook，到 `docs/ops/postgres-cutover.md`
- 提供 `scripts/archive_sqlite.sh` 把 `db/database.db` 拷贝到仓库外 `archive/db-<epoch>/database.db` 并加 sha256
- 14 天后清理 archive
- Rollback：恢复 dialect=sqlite，从 archive 拷回

## Open Questions

- `accounts.cookies/`（filesystem 路径 JSON 文件）不归 DB 管，但 `_sync_cookie_files_to_db()` 把 cookie 文件录入 `account_authorizations`。如果未来账户 >100，是否应改为纯 DB（`account_cookies` 表，JSONB blob + BYTEA 也行）？本 PR 不动。
- `error_events.traceback` 当前是 TEXT，应用层 cap=8000；size 大，是否应迁移到 S3 / 文件归档 + DB 只存 hash？本 PR 不动。
- 是否启用 `pgvector` 存 AI 生成的向量缓存（用于 semantic replay / "上次答得不错"）？本 PR 不动。
- Alembic 是否要落到 developer workflow（`uv run alembic revision --autogenerate`）？需要设计 owners 角色，PR3 暂只做 baseline。

