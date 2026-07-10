## Context

### 现状盘点

- **`script-studio`（openspec/changes/script-studio）** 已落地 v0.1：项目 CRUD（`studio_projects` / `studio_episodes` / `studio_assets` 三表）、`StudioPage` 项目列表、`StudioDetailPage` 项目详情（含分集列表 + 素材列表 + 成片播放器）。后端 `web_runner/routes/studio.py` 已注册 Blueprint，`web_runner/db.py` 已建表 + 双方言索引。
- **前端架构**：React 19 + React Router v7 + Zustand + TanStack Query + shadcn/ui（Radix + Tailwind v4）；页面统一放 `src/Pages/`，功能组件放 `src/Components/<Feature>/`，API 客户端放 `src/api/`，状态放 `src/stores/`。
- **数据库**：SQLite 开发 / PostgreSQL 生产，双方言表结构由 `web_runner/db.py:_init_db_sqlite` 和 `_init_db_postgres` 共同维护；新增列必须两边同步。
- **tldraw 技术选型背景**：经过 5 个开源方案对比（tldraw / Excalidraw / react-flow / Konva.js / Fabric.js），tldraw 在轻量（~200KB gzip）、原生 React、嵌入成本、数据模型清晰度四个维度胜出。Excalidraw 作为 fallback（包体积 ~400KB，手绘风格）。

### tldraw 方案评估矩阵

| 方案 | 包大小 | 协议 | React 原生 | 故事板适配 | 数据持久化 | 选择 |
|---|---|---|---|---|---|---|
| **tldraw** | ~200KB | tldraw license | ✅ `<Tldraw />` | ✅ 形状/箭头/图片 | ✅ `getSnapshot()` / `put()` | **主方案** |
| Excalidraw | ~400KB | MIT | ✅ 组件 | ✅ 手绘风格 | ✅ JSON | fallback |
| react-flow | ~150KB | MIT | ✅ | ❌ 无自由绘图 | ✅ | 补充方案（流程图） |
| Konva.js | ~100KB | MIT | react-konva | 需大量开发 | 需自建 | ✗ |
| Fabric.js | ~300KB | MIT | 需封装 | 需大量开发 | 需自建 | ✗ |

### 关键约束

1. **轻量化**：tldraw ~200KB gzip，不影响现有打包体积；按需懒加载（`lazy(() => import('...'))`）进一步减小首屏。
2. **React 原生**：`<Tldraw />` 一行嵌入，无缝集成到现有 `StudioDetailPage`。
3. **数据持久化**：tldraw `store.getSnapshot()` 产出 JSON，直接存 `canvas_data` 列。
4. **离线可用**：tldraw 完全客户端运行，保存时才走网络。
5. **性能**：tldraw 内部用 WebGL 加速渲染 + 视口虚拟化，大量图形元素不卡顿。
6. **协议风险**：tldraw license 非标准 MIT，商业 SaaS 需购买授权——锁定版本，定期评估 Excalidraw 作为替代。

## Goals / Non-Goals

### Goals

- Phase 1：**让运营能画**——tldraw 嵌入 + 基础绘图 + 自动保存 + 数据持久化
- Phase 2：**让画布与剧本联动**——素材图章 + 导出 PNG/SVG + 交叉高亮
- Phase 3：**让流程可视化**——react-flow 节点连线 + 版本历史（可选）
- 复用现有 shadcn 组件体系（Button / Toast / Sheet），零新增 UI 框架
- 复用现有 `_load_project` 鉴权模式，不造新权限逻辑
- 复用现有 TanStack Query `useQuery` / `useMutation` 模式，画布数据随项目详情一起拉取

### Non-Goals

- **不做实时协作**：tldraw Cloud 是付费服务，自建 WebSocket 同步成本高 → v2.0+ 考虑
- **不做版本历史**：当前阶段 canvas_data 与项目 1:1，last-write-wins → v2.0+ 方案 B 独立表 + version
- **不做画布数据 diff**：全量保存快照，不做增量 diff → 性能优化留到画布数据超 `SAU_STUDIO_CANVAS_MAX_SIZE`（默认 10 MiB UTF-8 字节 ≈ 10,485,760 bytes；详见 Decision #2 大小测量约定）时再处理
- **不做自定义渲染引擎**：不替换 tldraw 内部渲染，不做 Konva / Fabric 自建方案
- **不做移动端画布专属 UI**：tldraw 自带响应式触控支持，不额外优化

## Decisions

### 1. 数据模型：方案 A（单列扩展）

**选择**：在 `studio_projects` 表新增 `canvas_data TEXT/JSONB` 列。

**理由**：
- 画布与项目是强 1:1 关系，单列改动最小
- 删除项目时 `ON DELETE CASCADE` 自动清理画布数据
- 当前阶段不需要版本历史（last-write-wins 足够）
- 性能问题可以后续优化（懒加载 canvas_data，或拆到方案 B 独立表）

**方案 B（独立表）留到 v2.0+**：
```sql
CREATE TABLE studio_canvas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE
);
```

### 2. tldraw 数据透传：后端不解析画布内容

**选择**：后端仅做大小限制 + JSON 对象类型检查，不解析 tldraw 内部 schema。

**理由**：
- tldraw schema 随版本演进，后端解析会引入版本耦合
- 后端只需要存储和返回，不需要理解画布内容——不解析 tldraw 内部结构（`schema` 字段 + `store.records` 中所有 shape / binding 类型 + 未来新增字段），全部视为不透明存储，唯一判断是「是 JSON 对象 / null」 + 「UTF-8 字节数 ≤ 上限」
- 大小限制（10 MiB UTF-8 字节）已足够防止滥用
- 前端 tldraw 实例自带 migration 机制，旧快照自动升级

**大小测量约定**：`SAU_STUDIO_CANVAS_MAX_SIZE` 上限是 **UTF-8 编码字节数**，用 `len(json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))` 度量（`specs/canvas-editor/spec.md` 第 1 个 Requirement + 第 3 个 Scenario 详述）。`ensure_ascii=False` + `separators=(",", ":")` 是必填项——这样后端产出的 JSON 字节流与前端 `JSON.stringify` + `TextEncoder().encode()` 完全一致，前后端预检 / 400 边界不会因 `json.dumps` 默认值（`ensure_ascii=True` + `(", ", ": ")` 空格分隔）而错开。实施者若直接写 `len(json.dumps(...))` 而不传这两个参数，相当于在用 Python `str` 字符数 + 多余空格估算，会让上限门监变高并且和前端不一致，务必遵循 spec.md。

### 3. 自动保存策略：防抖 3 秒 + 离开提示

**选择**：
- `editor.store.listen()` 检测变化 → `isDirty = true`
- 防抖 3 秒后自动保存
- `beforeunload` 事件检查 `isDirty` → 浏览器原生离开提示

**理由**：
- 3 秒防抖平衡了保存频率和服务器负载
- 离开提示防止意外丢失修改
- 保存失败时自动重试 3 次，`isDirty` 保持 true

### 4. 懒加载 tldraw：按需引入

**选择**：`CanvasEditor` 用 `lazy(() => import('./CanvasEditor'))` 懒加载，tldraw 不进入主 bundle。

**理由**：
- tldraw ~200KB gzip，虽然不算大但不是每个用户都会用画布
- 懒加载确保 `StudioDetailPage` 首屏不受 tldraw 影响
- 用户点击「画布」标签后才加载 tldraw

### 5. 工具栏定制（Phase 2）

**选择**：Phase 1 用 tldraw 默认工具栏；Phase 2 用 `Tldraw` 的 `components` prop 自定义工具栏，精简为故事板场景专用工具。

**理由**：
- Phase 1 优先跑通「能画 + 能存」，工具栏定制是 UX 打磨
- tldraw 默认工具栏已经覆盖 80% 故事板需求（形状 / 线条 / 文字 / 图片 / 橡皮擦）
- Phase 2 精简为：选择 / 画笔 / 矩形 / 椭圆 / 箭头 / 文字 / 图片 / 橡皮擦

### 6. 素材图章（Phase 2）

**选择**：Phase 2 实现 `studio_assets` → 画布图章的拖拽。从 `AssetPlanner` 拖拽角色/场景/道具卡片到画布，tldraw 创建一个带 asset code 标注的图片形状。

**理由**：
- 画布与剧本数据的联动是白板功能的核心价值
- tldraw 支持自定义 shape，可以创建 `AssetStampShape`（带 code + name + prompt 元数据）
- 点击图章 → 高亮引用该 asset 的镜头（复用 `script-viewer` 的 `data-asset` 高亮机制）

### 7. 画布数据懒加载：专用 GET 端点而非随项目详情返回

**选择**：新增 `GET /api/studio/projects/{id}/canvas` 专用端点，`canvas_data` **不**包含在 `GET /api/studio/projects/{id}` 项目详情响应中。

**理由**：
- 画布数据可达 10MB，随项目详情一起返回会拖慢 `StudioDetailPage` 首屏加载
- `CanvasEditor` 用 `lazy()` 懒加载，用户不打开画布标签时完全不需要拉取画布数据
- 专用端点让画布数据有独立的缓存键（`['studio-canvas', projectId]`），不影响项目详情的 `useQuery` 缓存
- `GET /projects/{id}` 响应结构不变，向后兼容现有前端代码

**实现**：
```python
@bp.get("/api/studio/projects/<int:project_id>/canvas")
def get_canvas(project_id: int):
    user_id = _current_user_id()
    project = _load_project(user_id, project_id)
    if project is None:
        return jsonify({"success": False, "message": "项目不存在"}), 404
    db = get_database()
    return jsonify({
        "success": True,
        "data": {"canvas_data": db.json_load(project.get("canvas_data"))},
    }), 200
```

## Risks / Trade-offs

| 风险 | 缓解措施 |
|---|---|
| tldraw 协议变更（非标准 MIT） | 锁定版本 `tldraw@^2.x`；定期评估 Excalidraw 作为 fallback；商业 SaaS 部署前购买授权 |
| 画布数据过大（>10MB UTF-8 字节） | 后端硬限制 `SAU_STUDIO_CANVAS_MAX_SIZE`（默认 10MB，**UTF-8 编码字节数**，度量公式 `len(json.dumps(..., ensure_ascii=False, separators=(",", ":")).encode("utf-8"))`；详见 Decision #2「大小测量约定」+ `specs/canvas-editor/spec.md`）→ 400；前端保存前预检大小 → Toast 提示精简 |
| tldraw 版本升级 schema 不兼容 | tldraw 内置 migration 机制自动迁移旧快照；后端不解析 tldraw 内部结构（schema 字段 + 所有 shape / binding / 未来字段均视为不透明）— 参 `canvas-editor` spec 的 `Backend is schema-version-agnostic` Requirement |
| 性能问题（大量图形元素） | tldraw 内部 WebGL 加速 + 视口虚拟化；懒加载确保不影响首屏 |
| 并发编辑（同账号两浏览器） | last-write-wins（后写入覆盖先写入）；v2.0+ 考虑乐观锁 |
| 打包体积增长 | tldraw ~200KB gzip 懒加载，不进入主 bundle；`vite-bundle-visualizer` 定期检查 |
| 兼容性问题 | 充分测试，渐进式集成；Phase 1 只嵌入不影响现有功能 |

## Migration Plan

### Phase 1 — 基础白板集成（1-2 周）

1. DB：`studio_projects` 新增 `canvas_data` 列（SQLite + PG 同步，沿用已有 ALTER TABLE 幂等迁移模式）
2. API：`GET /api/studio/projects/{id}/canvas`（懒加载）+ `PATCH /api/studio/projects/{id}/canvas`（保存）
3. 前端：安装 tldraw 依赖 → `CanvasEditor` + `TldrawWrapper` + `CanvasActions`
4. 前端：`StudioDetailPage` 嵌入 `CanvasEditor`（懒加载）
5. 前端：`studioApi.saveCanvas` 方法
6. 前端：自动保存（防抖 3s）+ 离开提示
7. Test：后端 pytest + 前端 Vitest

### Phase 2 — 功能增强（2-3 周）

1. 自定义工具栏（精简为故事板场景）
2. 导出 PNG / SVG
3. 素材图章（`AssetPlanner` → 画布拖拽）
4. 画布与分集数据交叉高亮

### Phase 3 — 高级功能（3-4 周，可选）

1. react-flow 集成（故事结构流程图）
2. 版本历史（方案 B 独立表）
3. 协作评审（tldraw Cloud 或自建 WebSocket）
4. 性能优化（增量保存 / 压缩存储）

### 回滚策略

任何一个 Phase 不通过 → 删除对应文件/路由，`canvas_data` 列保留但前端不渲染画布区块。Phase 1 的 DB 列变更是向后兼容的（NULL = 空画布），不需要回滚 DDL。

## Open Questions

- [ ] 是否购买 tldraw 商业授权？→ 取决于产品是否走向 SaaS 模式（当前私有部署免费）
- [ ] 是否做画布数据压缩（msgpack / protobuf）？→ 当前 JSON 够用，`SAU_STUDIO_CANVAS_MAX_SIZE`（默认 10 MiB UTF-8 字节 ≈ 10,485,760 bytes；详见 Decision #2 大小测量约定）限制内不压缩
- [ ] 是否与 `inbox`（素材收件箱）打通？→ v2.0 考虑，可让 inbox 下载的素材直接拖到画布
- [ ] 是否启用 react-flow 做流程图？→ Phase 3 评估，看用户是否需要节点连线场景
- [ ] 是否做画布模板（故事板 / 分镜模板）？→ Phase 2 考虑，预设几个模板供用户快速开始
