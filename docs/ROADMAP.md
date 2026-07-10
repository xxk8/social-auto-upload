# social-auto-upload 完善方向路线图（Roadmap）

> 本文档基于对代码库四个层面（Python 上传器、React 前端、文档/工程化、后端结构）的探索，整理出可按优先级推进的完善方向，供后续迭代参考。
>
> **更新于 2026-07-07**：已根据当前代码库状态校准各方向现状描述，修正过时信息。

---

## 一、平台上传能力补全（最高价值，直接扩大可用面）

| 缺口 | 现状 | 建议 |
|---|---|---|
| **B站浏览器上传** | `uploader/bilibili_uploader/main.py` 的 `upload()` 仍抛 `NotImplementedError`。当前 B站视频上传走 `biliup` CLI 运行时（`runtime.py` 自动下载 + 调用），cookie 校验已打通。浏览器自动化路径尚未实现。 | 如需浏览器上传路径，补充 `upload()` 的具体 DOM 操作；当前 CLI 路径已可用，优先级可降低 |
| **YouTube 定时发布** | Studio 无调度 UI，定时能力❌ | 先上传为"私有草稿"，再用 YouTube Data API 设 `publishAt` 完成定时 |
| **百家号 / YouTube 图文** | 两者图文均❌ | 补全图文分支（百家号有草稿能力，可优先） |
| **TikTok 图文** | 仅 stub | 补齐图文上传实现 |

---

## 二、上传器架构重构（降低维护成本）

当前 `BaseVideoUploader` 是纯 classmethod 命名空间，派生类大量复制：

- `account_file / publish_date / headless` 等属性
- `_msg / _build_login_result` 等函数
- `obfuscate_video / obfuscate_image` 调用

**建议：**

1. 引入真正的 `__init__` 基类 + `super()` 调用，统一属性初始化
2. 将已存在的登录契约 `cookie_auth() / xxx_setup() / xxx_cookie_gen()` 抽成抽象基类方法
3. 抽出 `common.py` 中关于登录结果构建、混淆调用的公共实现，消除各平台复制粘贴

---

## 三、后端与基础设施（生产化关键）

- **数据库**：Postgres 支持已在 `web_runner/db.py` 落地为正式可切换后端（`SAU_DB_DIALECT=postgres` + 连接池 + psycopg 异常翻译层）。SQLite 作为零配置回退仍可用。后续可关注连接池调优与读写分离。
- **鉴权强度**：`middleware/` + `oauth.py` 已存在（Google / GitHub OAuth + 邮箱验证码），但应尽快补齐密码哈希强度、会话过期、API 限流、审计覆盖全部敏感操作。
- **API 文档**：建议加 OpenAPI / Swagger（路由层已分层，接入成本低）。
- **可观测性**：缺结构化监控与告警（上传失败率、Cookie 过期、队列积压），可复用现有 `logs/` 体系做指标导出。
- **任务队列**：定时发布目前依赖 cron / 进程内调度，建议引入持久化队列（如 Redis / RQ）以保证重启不丢任务。

---

## 四、工程化与质量（守住已有成果）

- **前端测试**：vitest 全部通过（2,277 tests · 48 files），含开源引用 guard 测试（`no-opensource-references.test.ts`）。
- **CHANGELOG 缺失**：建议补 `CHANGELOG.md` 并建立 release 流程。
- **CI 加固**：已有 `scripts/dev_docs_audit.py` 锁死文档三角引用，建议把 Python pytest + 前端 vitest 都纳入 CI gate 持续守护。
- **Python 层编码规范**：DESIGN 体系只覆盖前端；`uploader / cli` 层缺可执行命名/结构规范，建议补一份 Python 侧 CONTRIBUTING / style 指南。

---

## 五、产品 / UX 增强

- **移动端适配**：前端已有底部 Tab，但桌面端功能未全量移动化，可优先做发布向导与任务看板的移动版。
- **批量与编排**：发布向导已支持多账号组，但跨平台"一次创作多平台变体"的 AI 改写流水线可进一步强化（AI 侧边栏已具备平台变体能力，可串联到发布流）。
- **监控告警面板**：数据分析页已有图表，可加"上传成功率 / 失败原因分布"运维视图。
- **国际化**：目前 UI 全中文，若面向海外用户可引入 i18n。

---

## 5.1 已设计方案（待实现）

以下功能已完成设计文档，可按优先级推进实现：

| 功能 | 设计文档 | 核心价值 | 预估工作量 |
|---|---|---|---|
| **Webhook 通知** | [`DESIGN-webhook-notifications.md`](DESIGN-webhook-notifications.md) | 上传结果主动推送到飞书/钉钉/企业微信，运营者无需反复刷新页面 | 5-7 天 |
| **批量导入上传** | [`DESIGN-batch-import.md`](DESIGN-batch-import.md) | CSV/JSON 批量创建上传任务，矩阵号运营效率提升 10 倍 | 5-6 天 |
| **内容日历视图** | [`DESIGN-content-calendar.md`](DESIGN-content-calendar.md) | 可视化排期，拖拽调整，一眼掌握发布节奏 | 6-7 天 |

---

## 六、反检测 / 合规（已有基础，可深化）

`utils/anti_detect` 已有 stealth、内容指纹四层能力，建议补充：

- 各平台**上传频率自适应限速**（按账号权重 / 平台风控动态调整）
- Cookie **自动刷新与失效预警**（已有 `scripts/refresh_douyin_cookies.py` 脚本，可产品化为后台任务）

---

## 建议优先级

1. **平台闭环补全**（B站浏览器上传 / YouTube 定时）—— 直接扩大产品可用面
2. **CI gate + CHANGELOG** —— 低成本、高收益、守住质量
3. **后端鉴权生产化** —— 多用户场景下的安全性
4. **架构重构** —— 降低后续功能迭代的维护成本
5. **产品增强** —— UX 与运营能力升级

---

*生成依据：对 `/uploader`、`/utils/anti_detect`、`/cli`、`/sau_web/frontend`、`/web_runner`、`/db`、`/docs`、`/tests` 等目录的结构化探索。*
