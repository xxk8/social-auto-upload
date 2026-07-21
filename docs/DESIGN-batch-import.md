# 批量导入上传设计方案

> 状态：Draft
> 作者：MiMoCode
> 日期：2026-07-08

---

## 1. 背景与目标

### 1.1 问题

当前创建上传任务的方式：

| 方式 | 限制 |
|---|---|
| Web Shell 手动添加 | 一次只能添加一个任务，逐条填写表单 |
| CLI 逐条执行 | 需要手动拼命令，无法批量 |
| Web Shell 发布向导 | 支持多账号，但仍需手动选择视频和填写信息 |

对于需要一次性发布 10+ 视频的运营场景（如矩阵号运营、活动期间集中发布），效率极低。

### 1.2 目标

支持通过**结构化文件**批量导入上传任务，一次创建多个待执行任务：

```
用户准备 CSV/JSON 文件
        │
        ▼
Web Shell / CLI 导入
        │
        ▼
校验 + 预览
        │
        ▼
批量创建任务
        │
        ▼
按策略执行（顺序/并发/定时）
```

---

## 2. 用户故事

### 2.1 核心用户：矩阵号运营者

```
作为矩阵号运营者，我想要：
├─ 准备一个 CSV 文件描述所有视频 → 避免逐条操作
├─ 导入后预览确认 → 防止配置错误
├─ 一键创建所有任务 → 批量执行
├─ 导入模板下载 → 快速上手
└─ 导入错误提示 → 知道哪里填错了
```

### 2.2 使用场景

| 场景 | 视频数量 | 说明 |
|---|---|---|
| 日常批量发布 | 5-20 | 多账号矩阵，同一视频发多个平台 |
| 活动集中发布 | 20-50 | 营销活动期间集中投放 |
| 内容迁移 | 50-200 | 从其他平台迁移历史内容 |
| 定期批量排期 | 10-30 | 提前一周排好下周发布计划 |

---

## 3. 设计方案

### 3.1 CSV 格式规范

```csv
video_file,title,desc,tags,platforms,account,schedule,thumbnail,tid,draft
videos/v1.mp4,示例标题1,示例描述1,标签1;标签2,douyin;bilibili,work1,2026-07-10 10:00,,,
videos/v2.mp4,示例标题2,示例描述2,标签3,xiaohongshu,work2,,,249,
videos/v3.mp4,示例标题3,,,"douyin;kuaishou",work1,,,,
```

#### 字段说明

| 字段 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `video_file` | ✅ | 视频文件路径（相对于 CSV 所在目录或绝对路径） | `videos/v1.mp4` |
| `title` | ✅ | 发布标题 | `示例标题` |
| `desc` | ❌ | 视频简介（视频上传用） | `示例描述` |
| `tags` | ❌ | 标签，多个用 `;` 分隔 | `标签1;标签2` |
| `platforms` | ✅ | 目标平台，多个用 `;` 分隔 | `douyin;bilibili` |
| `account` | ✅ | 账号标识名 | `work1` |
| `schedule` | ❌ | 定时发布时间，空则立即发布 | `2026-07-10 10:00` |
| `thumbnail` | ❌ | 封面图路径 | `covers/v1.jpg` |
| `tid` | ❌ | Bilibili 分区 ID | `249` |
| `draft` | ❌ | 是否保存为草稿（`true`/`false`） | `true` |

### 3.2 JSON 格式规范

```json
{
  "tasks": [
    {
      "video_file": "videos/v1.mp4",
      "title": "示例标题1",
      "desc": "示例描述1",
      "tags": ["标签1", "标签2"],
      "platforms": ["douyin", "bilibili"],
      "account": "work1",
      "schedule": "2026-07-10 10:00"
    },
    {
      "video_file": "videos/v2.mp4",
      "title": "示例标题2",
      "platforms": ["xiaohongshu"],
      "account": "work2",
      "tid": 249
    }
  ],
  "options": {
    "strategy": "sequential",
    "concurrency": 3,
    "delay_seconds": 30,
    "on_failure": "skip"
  }
}
```

#### options 字段

| 字段 | 说明 | 默认值 |
|---|---|---|
| `strategy` | 执行策略：`sequential`（顺序）/ `parallel`（并发） | `sequential` |
| `concurrency` | 并发数（parallel 模式下生效） | `3` |
| `delay_seconds` | 任务间隔（秒），防平台限流 | `30` |
| `on_failure` | 失败处理：`skip`（跳过）/ `stop`（停止）/ `retry`（重试） | `skip` |

### 3.3 校验规则

导入时进行以下校验：

| 校验项 | 规则 | 错误示例 |
|---|---|---|
| 文件存在性 | `video_file` 指向的文件必须存在 | `行 3: 视频文件不存在 videos/v5.mp4` |
| 格式支持 | 视频格式必须在 `SUPPORTED_VIDEO_EXTENSIONS` 中 | `行 5: 不支持的格式 .avi` |
| 平台有效性 | `platforms` 中的平台必须在已支持列表中 | `行 2: 未知平台 weibo` |
| 账号有效性 | `account` 对应的 Cookie 文件必须存在 | `行 4: 账号 notexist 无对应 Cookie` |
| 时间格式 | `schedule` 必须是合法的 `YYYY-MM-DD HH:MM` | `行 1: 时间格式错误 07-10-2026` |
| Bilibili 必填 | Bilibili 平台必须提供 `tid` | `行 3: Bilibili 需要 tid 字段` |
| 标题长度 | 不超过各平台限制（抖音 55 字，Bilibili 80 字等） | `行 1: 标题超过抖音 55 字限制` |

### 3.4 API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/tasks/import/preview` | 上传文件，返回预览（校验结果 + 任务列表） |
| POST | `/api/tasks/import/confirm` | 确认导入，批量创建任务 |
| GET | `/api/tasks/import/template` | 下载 CSV 模板 |
| GET | `/api/tasks/import/history` | 导入历史记录 |

#### 预览接口响应

```json
{
  "success": true,
  "data": {
    "total_rows": 15,
    "valid_rows": 13,
    "errors": [
      { "row": 5, "field": "video_file", "message": "视频文件不存在 videos/v5.mp4" },
      { "row": 8, "field": "platforms", "message": "未知平台 weibo" }
    ],
    "tasks": [
      {
        "row": 1,
        "video_file": "videos/v1.mp4",
        "title": "示例标题1",
        "platforms": ["douyin", "bilibili"],
        "account": "work1",
        "estimated_tasks": 2
      }
    ],
    "estimated_total": 28
  }
}
```

#### 确认接口请求

```json
{
  "import_id": "imp_abc123",
  "skip_errors": true,
  "options": {
    "strategy": "sequential",
    "concurrency": 3,
    "delay_seconds": 30
  }
}
```

### 3.5 CLI 支持

```bash
# 导入 CSV
sau import tasks.csv

# 导入 JSON
sau import tasks.json --strategy parallel --concurrency 5

# 仅预览，不创建
sau import tasks.csv --dry-run

# 下载模板
sau import --template > tasks.csv
```

### 3.6 前端：导入对话框

在任务管理页面增加「批量导入」按钮：

```
任务管理页面
├─ 搜索栏
├─ 状态筛选
├─ 批量操作
├─ + 添加任务
├─ 📥 批量导入      ← 新增按钮
└─ 任务列表

点击「批量导入」→
┌─────────────────────────────────────────┐
│  批量导入任务                            │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  拖拽 CSV/JSON 文件到此处          │   │
│  │  或 点击选择文件                   │   │
│  └──────────────────────────────────┘   │
│                                          │
│  📥 下载 CSV 模板                        │
│                                          │
│  ┌─ 导入选项 ────────────────────────┐  │
│  │  执行策略: [顺序 ▾]               │  │
│  │  并发数:   [3  ]                  │  │
│  │  任务间隔: [30 ] 秒               │  │
│  │  失败处理: [跳过 ▾]               │  │
│  └──────────────────────────────────┘  │
│                                          │
│  预览结果:                               │
│  ✅ 13 行有效  ❌ 2 行错误               │
│  预计创建: 28 个任务                      │
│                                          │
│        [取消]  [导入并创建]              │
└─────────────────────────────────────────┘
```

### 3.7 实现优先级

| 阶段 | 内容 | 预估工作量 |
|---|---|---|
| P0 | CSV 解析 + 校验 + 预览 API + CLI `sau import` | 2 天 |
| P1 | Web Shell 导入对话框 + 确认创建 | 1.5 天 |
| P2 | JSON 格式支持 + 执行策略选项 | 1 天 |
| P3 | 导入历史 + 模板下载 | 0.5 天 |

---

## 4. 技术要点

### 4.1 文件处理

- CSV 使用 Python 标准库 `csv` 模块，支持 UTF-8-BOM 编码
- JSON 使用标准 `json` 模块
- 大文件分块读取（避免一次性加载到内存）
- 上传文件存储到临时目录，处理后清理

### 4.2 任务创建

- 批量创建在同一数据库事务中完成
- 每行 CSV 生成一个 `task_id`（前缀 `imp_`）
- 导入元数据记录到 `import_history` 表

### 4.3 并发控制

- `sequential` 模式：任务队列顺序执行
- `parallel` 模式：使用 `ThreadPoolExecutor` 控制并发数
- 任务间延迟通过 `time.sleep` 实现（简单可靠）

---

## 5. 开放问题

- [ ] 是否支持导入时自动为同一视频生成多平台变体标题（AI 改写）？
- [ ] 是否支持从 Excel 文件导入？
- [ ] 导入时是否需要支持视频去重（相同文件名跳过）？
