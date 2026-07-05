# Hot-reload Design Philosophy

> **TL;DR (≈30 秒读完)** — 我们选 (C)。原因: Python 的 `importlib.reload` 不可靠 (A 在生产代码里反复踩坑),supervisord 太重 (B 在 dev 上是 overkill),watchdog + 自写 50 行脚本 (`scripts/dev_watch.py`) 是 dev cycle 里"刚好的复杂度"。本文把三方案的 trade-off 摊开来,供后续 reviewer / 想替换方案的人参考。

## Why this exists

Web Stack 当前 dev 循环的 `kill -9 / setsid nohup / 几秒 tail` 三步骤每天约做 30 次 — 错的工具(`importlib.reload`)会把 reload 不可靠性传遍整个项目,过重的工具(`supervisord`)是把 prod infra 搬到 dev 的 overkill。 本文挑明"A/B/C 三方案 trade-off → 我们选 C",让未来 reviewer 想换路线时有同一张评估记录,不再"重写整个项目以适配工具"。 文档 style 对齐同目录 `postgres-getting-started.md` — "Option 摆开 → 选谁 → 为什么"节拍。

## Prereqs

假设 reader 已在 dev mode 启动 Web Stack(后端 `:6001` + Vite `:5180`);已读过 `docs/install.md` 后端 setup 入口;并在写代码期间实际跑过 `lsof -ti:6001 / kill -9 / setsid` 这套手动步骤(否则 `## 6. 运行时 semantics` 这节对你不是 motivate 出来的)。 本文不重复 install 步骤,默认 reader 已经在 dev 循环里。

## 1. Background & scope

**这是 dev-only 文档。** Production 进程监督走 supervisord / podman / k8s — 那是另一套"online 上线"的工程问题,与本文无关。

Web Stack 当前 dev 循环:

1. 修改 `web_runner/` / `uploader/` / `cli/` / `run.py` 中某个文件;
2. 找到正在跑 `:6001` 的 backend PID (`lsof -ti:6001`);
3. `kill -9` 它;
4. `setsid nohup .venv/bin/python run.py > .sau-logs/backend.log 2>&1 &`;
5. 等几秒;
6. 重发 curl 验证。

步骤 2 → 5 每天做 ~30 次。**省掉这三步的工具收益 — 远超其本身的代码量。** 但选错了工具,反而会让 dev 节奏更慢 (context switch / 状态泄漏 / 不必要的外部依赖)。

## 2. 三方案一览

| 维度 | (A) 进程内 `importlib.reload` | (B) supervisord 监视重组 | (C) `scripts/dev_watch.py` (本项目实质采用) |
|---|---|---|---|
| **核心机制** | watchdog 监听 mtime → `importlib.reload(web_runner.db)` | watchdog 监听 mtime → supervisord 触发 `[program:sau_backend]` restart | watchdog 监听 mtime → 脚本自行 SIGTERM + Popen |
| **外部依赖** | 无 | supervisord + config parser | `watchdog>=4.0` (dev-only dep) |
| **Down-time per restart** | 0 (理论上) | 1–3 s | 1–3 s (SIGTERM 10s grace → SIGKILL 5s fallback) |
| **进程模型** | 单进程,reload 原地 | 双进程 (supervisord 主 + 后端从) | 单对子进程,PID 内跟踪 |
| **psycopg 连接池** | ⚠️ reload 之后**泄漏**,旧 socket 挂在新 class 上 | ✅ supervisord 重启整进程 | ✅ 单进程被替,旧池自然丢弃 |
| **Flask 路由绑定** | ❌ routes 在 `before_request` 已经绑老 class,reload 不可逆 | ✅ 整进程重启,绑定重做 | ✅ 整进程重启 |
| **In-flight Playwright 登录** | ⚠️ 中断但不通知,半途失踪 | ⚠️ 同样失踪,但 supervisord 日志里能 grep | ⚠️ 同样失踪,`.sau-logs/dev_watch.log` banner 是 grep 锚点 |
| **配置/学习成本** | 0 单文件 | ⚠️ systemd unit + supervisord.conf + 进程组 / FD 继承的暗坑 | 看 50 行新代码,无额外配置 |

> **TL;DR**:(A) 在生产代码维度反复跨坑,(B) 是 prod infra 搬到 dev 的 overkill,(C) 是 dev-specific 的"刚好够"。本项目选 (C)。

## 3. Option A — `importlib.reload` (进程内)

### 怎么实现

```python
# 思路伪代码,不是最终实现
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import importlib

class ReloadHandler(FileSystemEventHandler):
    def on_any_event(self, event):
        if event.src_path.endswith(".py") and "web_runner" in event.src_path:
            import web_runner.db
            importlib.reload(web_runner.db)  # ← 看似一行
```

### 为什么本项目不接受

`importlib.reload` 在 CPython 文档里有句**重要警示**:

> If a module imports objects from another module using `from ... import ...`, calling `importlib.reload()` will not re-import those objects — it can leave references pointing to old versions of objects.

落到本项目,具体踩坑如下:

1. **`web_runner.db.parse_date_param` 不是路由层用的对象** —— 当分析端点收到请求时,`request.args` 走 Flask `werkzeug.urls` 解析,然后路由调 `parse_date_param`。如果你 reload `db.py`,`routes/analytics.py` 里那条 `from web_runner.db import parse_date_param as _parse_date` 的 import 已经把旧 `parse_date_param` 绑到了 `_parse_date` 名字上 —— `reload` 改的是 `web_runner.db.__dict__`,`routes/analytics._parse_date` 仍指向旧 closure / class 对象。**reload 对路由透明,路由继续用旧版本。**
2. **`web_runner.db._default_database` 是 module-level 单例** —— `reload` 之后,模块 id 变了(class id 不同),但旧单例对象仍被 `web_runner.__init__.create_app()` 持有的 ref 捏着。结果:新 `get_database()` 创建新 `_default_database`,但旧进程正在用的是旧单例。两个池并行存在,psycopg 连接受双重计数。
3. **`Flask.before_request` 已经把路由绑到 dispatcher** —— `app.run()` 一启动,路由表 freezed;reload 永远不影响已绑路由。要真生效,必须再 `app.run()` 重启,跟 (C) 路径同质。
4. **测试 fixture 的 monkeypatch 在 reload 下全部失效** —— `tests/conftest.py` 用了 `conftest.setenv` patch `web_runner.db._default_database`,reload 让 module-level reference 漂移,**patch 不到实例**。

A 路径理论上能跑通,但代价是:每个 import 都得用 `module.attr` 而不是 `from … import name`,每处都要主动 `importlib.reload` 后续 reload。这是"重写整个项目以适配工具"的反模式。

## 4. Option B — supervisord 监视重组

### 怎么实现

```ini
; supervisord.conf
[program:sau_backend]
command=/Users/.../social-auto-upload/.venv/bin/python run.py
directory=/Users/.../social-auto-upload
autostart=true
autorestart=true
environment=SAU_DB_DIALECT="postgres",DATABASE_URL="postgres:///sau",SAU_CORS_ALLOWED_ORIGINS="http://localhost:5173,http://localhost:5180"
stdout_logfile=/Users/.../social-auto-upload/.sau-logs/backend.log

[eventlistener:fs_watcher]
command=/usr/local/bin/fswatch_supervisor
events=TEN_FILE_MODIFIED
directory=/Users/.../social-auto-upload/web_runner
; then somehow push an RPC to supervisord to restart sau_backend
```

`fswatch` → supervisorctl RPC 是 SupMac 圈子的标准 pattern,但需要:

- `supervisord` 二进制 (`brew install supervisor` / `apt install supervisor`);
- `fswatch_supervisor` event listener 桥接脚本(几十行 supervisor RPC);
- 平台特定 `fswatch` (macOS native,Linux `inotifywait` 不同命令语法);
- supervisorctl 的 UNIX 域 socket 权限 / auth 配置。

### 为什么本项目不接受(在 dev 角色)

1. **重量配置 vs dev 单次需求** — supervisord 的整个 infra 设计都是给"长时间跑、超时自动拉起"用的。dev loop 里我们只是想"save → 自动 reload",被 supervisord 的进程组、eventlistener、socket 权限这套压上来,踩坑多。
2. **1–3 s restart window 在 WebShell 仍然问题** — Playwright 抖音扫码登录(`uploader/douyin_uploader/main.py`)是 minutes 级工作流,supervisord restart 会在中途截断它,用户得重扫码。**两种 restart 路径对这条都同样脆弱**(C 也是),但 supervisord 不会让你少踩这一脚。
3. **进程模型噪音** — `ps aux | grep sau` 在 dev 期间会冒出两条 (supervisord + run.py),给运维 / debugging 增加读心成本。C 路径下只有 watcher + run.py 两条,且 watcher 自己写 `.sau-logs/dev_watch.log` 表明身份。
4. **新手门槛** — 同事第一天 checkout 本项目就要 `:wq supervisord.conf :wq fswatch_bridge.py` 才能开始写代码,这跟"web_ui 是产品级 UI"的定位矛盾。

**B 的合理使用场景(本项目不):production 进程监督、long-running worker supervisor、k8s pod readiness probe。** 这些是 C / (A) 不会做的领域。

## 5. Option C — `scripts/dev_watch.py` (本期采用)

### 为什么正好够

C 用一句话概括:**watchdog 监听 mtime → 自写脚本 kill 当前 `:6001` → Popen 拉新 → stdout 合到 `.sau-logs/backend.log`**。单文件、~250 行,无 binary supervisor、无 reload 风险。

Dev 视角的关键决策(各对应 review 修过一轮):

| 决策点 | 选 | 理由 |
|---|---|---|
| 进程发现 | **自跟踪 PID**(不 lsof) | 既然脚本自己 spawn,自己持有 PID,不需要每个 restart 都 scan `lsof -ti:6001` 跟外部进程兜圈子 |
| Pre-flight port-check | `lsof -ti:6001 -sTCP:LISTEN` | 万一开发者提前 `nohup run.py &` 占住端口,脚本不"接管别人的进程",直接 fail loud |
| 监听路径 | `web_runner/`, `uploader/`, `cli/`, `run.py` | `db/` 不监听(SQLite 写入防 restart loop);`.sau-logs/` 不监听(自己写日志防 loop);`__pycache__/` `.git/` `.venv/` `node_modules/` 都不监听(noise 路径一律忽略) |
| Debounce 窗口 | 800 ms | 编辑器原子保存(vim atomic rename)会触发两次 event,debounce 折叠到一次。 vim / IDEA / VS Code 三家通用 |
| 后置 burst 处理 | **coalesce-not-drop**,`_pending_restart` flag | SIGTERM 10s grace 内落地的 save 不会"被静默丢弃",grace 解完后再起一次 trailing restart(对比:drop 语义下,burst 最后一条可能 livelock 等 grace 结束而 backend 仍跑旧代码 |
| SIGTERM grace | 10 s + SIGKILL 5 s fallback | 长 grace 是为了让后端能完成 in-flight 的 acquire lock / 优雅落 commit 短 SQL。`SIGKILL` 是 escape valve,正常路径不打 |
| 退出码 | `sys.exit(128 + signum)` | Ctrl-C = 130,SIGTERM = 143,跟 shell 约定对齐,运维脚本能 grep `$?` |
| 日志 | backend 进程 → `.sau-logs/backend.log` (append,带 restart banner);watcher 自己 → `.sau-logs/dev_watch.log` | 两条线索,**grep `\=== dev_watch restart @` banner** 就能跨 restart cycle 切片 |

完整代码见 [`scripts/dev_watch.py`](../../scripts/dev_watch.py)。它的依赖 ([`watchdog>=4.0`](../../pyproject.toml#L58) in `[dependency-groups] dev`) **只在 dev 安装时被拉**,production 静默 `uv pip install -e .` 不会染上。

## 6. 运行时 semantics

跑 `python scripts/dev_watch.py` 之后 dev cycle 变成:

1. 编辑器保存 `.py`;
2. 800 ms 静默期(最后一次 save 之后);
3. 脚本 SIGTERM 老 PID,SIGKILL 兜底,起新 PID;
4. backend stdout 写入 `.sau-logs/backend.log` 的 `\n=== dev_watch restart @ {ts} ===\n` banner;
5. 浏览器下一次请求落到新进程(老进程 accept queue 因 SIGTERM 关掉)。

`scripts/dev_watch.py --dry-run` 模式不真的 spawn backend,只 log 哪些路径会被监听 — 用来给新合作者 demonstrate watch config。

## 7. C 路径不适合的场景(当 swappable)

| 场景 | 不适合 C 的理由 | 建议替代 |
|---|---|---|
| 生产部署 (`/app/accounts` 在公网) | dev 1–3 s restart window 不允许,watchdog 在生产机器上是攻击面 | 走 supervisord / systemd / k8s probe |
| 长任务 (e.g. `cloudupload` worker 跑 30 min) | restart 截断任务,重做代价高 | 走 k8s Job / task queue + retry |
| 多 backend 实例 (load-balanced N=3) | C 只跟踪一个 PID,不能 fan-out | 走 k8s Deployment + ConfigMap rolling restart |
| 容器内 dev (Docker / Podman 里调试) | watchdog 在容器里需要 `--add-host` + `fs.inotify.max_user_watches` 调优 | 走 volume mount + `ddev` / `skaffold` |

## 8. 何时回头选 (A) 或 (B)

如果本项目出现以下任一情况,本文档的"(C) 是最优解"前提失效,要回头重做:

- **pytest 加了运行 ≥ 5 分钟的 e2e 套件,且希望 test run 期间 hot-reload 仍生效** → (A) 的"reload 透明保住 in-flight test"就有价值了,值得把 A 的 import-rebind 病全部切到 `module.attr` 形式换上去。
- **dev 周期大量时间花在 `cli/` 子命令调测,Uvicorn-style `--reload` 不灵** → 评估 (A) on `cli/` 单独路径。
- **多人协作时新同事"不愿装 supervisord / 读 fswatch_bridge.py",宁愿 cycle 多敲几次** → 我们已经在 (C),无需改。

每次回头前应当重读本文 + 评估 trade-off。**不要把"换回 (A)/(B)"当成改进写进 PR 描述 — 那只是对现在 workload 重新合适。**

## 9. Maintenance notes

- **`scripts/dev_watch.py`** 当前是 ~250 行单文件,包含 `BackendLauncher` / `ReloadHandler` / `_check_port_unoccupied` / `_resolve_python` / `main` 五个公开符号。如果超过 ~600 行,考虑拆 `reload_handler.py` + `backend_launcher.py` 单独 unit-test。
- `DEFAULT_DEBOUNCE_MS = 800` — 这是经验值,实际效果因 IDE 而异(VSCode autoformat 经常一秒内 触发三次 save 事件,800 ms 够)。**改它必须注释,并在 commit message 写清触发场景。**
- 跨 restart banner `\n=== dev_watch restart @ {ts} ===\n` 在 backend.log 里被运营脚本按行 scan,改格式前请 `rg` 这字面量。
- 模块级 `_last_signum` 是 signal handler → `sys.exit(128+x)` 的状态载体,删它之前请确认 SIGINT / SIGTERM 行为可观测 (用 `bash -c 'sleep infinity & kill -INT $!; wait $!; echo $?'` 验证)。

## Cross-references

- 实际实现:[`scripts/dev_watch.py`](../../scripts/dev_watch.py) — 250 行,单文件。
- 依赖分支:[`pyproject.toml` `[dependency-groups] dev` row `watchdog>=4.0`](../../pyproject.toml) — dev-only,prod 静默。
- 上层使用入口:[`docs/install.md`](../../install.md) 与 [`docs/dev/optimization-checklist.md`](optimization-checklist.md) — 第一次跑新 dev 之前,这俩 install 文档已经把 watchdog 拉好。
- 同种类 philosophy 文档:
  - [`docs/dev/postgres-getting-started.md`](postgres-getting-started.md) — PostgreSQL 决策文档,跟本文同样采用 "Option 摆开 → 选谁 → 为什么" 节奏。本文档风格对齐它,以便后续 reviewer 用同一阅读姿势。
  - [`docs/install.md`](../../install.md) — 首次跑通口。
- Playwright in-flight 与 restart window 的容错策略 → [`uploader/douyin_uploader/main.py`'s `_extract_douyin_qrcode_src`](../../uploader/douyin_uploader/main.py) 注释段 — 说明二维码提取为什么不依赖 restart 周期。
- **Hub**: [docs/dev/INDEX.md#contributors](docs/dev/INDEX.md#contributors) — Contributors (writing code, merging PRs).

## 10. 历史

| 日期 | 事件 | 触发原因 |
|---|---|---|
| 2026-06-28 | 选定 (C),落地 `scripts/dev_watch.py` | 用户在 dev 期间每次 save 都手敲 `lsof / kill / nohup` 三步,需求常态化 |
| (待加) | 后续 fix 记录 | BackendLauncher `_pending_restart` coalesce、observer.join bounded、Unix `128+signum` exit (见 review commit) |

## 11. 一句话总结

**C 在 dev 维度上是对的复杂度——不引入 reload 不可靠性 (A) 也不引入 prod supervisor infra (B);单文件 ~250 行,debounce + coalesce + bounded join 解决了真实踩过的三个坑;后续 reviewer 想换方案必须先回答"C 不适合的 4 个场景"是否在本项目出现过。**
