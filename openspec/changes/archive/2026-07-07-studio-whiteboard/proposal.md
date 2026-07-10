## Why

`script-studio`（openspec/changes/script-studio）让运营能「从一句话灵感到多集剧本」，但**剧本到视觉之间还缺一环**——运营在写完分集剧情后，需要用图形化方式规划分镜、标注角色走位、标注场景关系。当前的工具链是：

1. **故事板靠纸笔或外部工具**：运营在 Procreate / Figma / 飞书白板上画分镜草图，再截图贴回 Studio，每一步都要手动同步。
2. **素材关系没有可视化**：角色(C) / 场景(S) / 道具(P) 的空间关系、出场顺序只能靠纯文本脑补，没有直观的画布标注。
3. **灵感丢失**：创作过程中闪现的构图灵感没有就地记录的入口——切到外部工具再切回来，上下文就断了。
4. **闭环没用上画布数据**：画板上的标注无法和已有的分集数据联动，导出分镜时只能看到文本，看不到运营标注的视觉关系图。

## What Changes

### 新增功能

#### Phase 1：基础白板集成

- 在 `StudioDetailPage` 中嵌入 [tldraw](https://tldraw.dev) 无限画布组件
- 支持基础绘图：矩形 / 椭圆 / 线条 / 箭头 / 文字 / 自由画笔 / 图片插入
- 支持画布缩放 / 平移 / 撤销 / 重做
- 画布数据持久化到 `studio_projects.canvas_data` 字段（方案 A：单列扩展）
- 自动保存（防抖 3 秒）+ 离开提示
- 新增 `GET /api/studio/projects/{id}/canvas`（懒加载）+ `PATCH /api/studio/projects/{id}/canvas`（保存）端点

#### Phase 2：功能增强

- 自定义工具栏（精简 tldraw 默认工具，突出故事板场景）
- 导出 PNG / SVG
- 自定义图章（从 `studio_assets` 中拖拽角色 / 场景 / 道具到画布）
- 画布与分集数据交叉高亮（点击画布上的角色图章 → 高亮引用该角色的镜头）

#### Phase 3：高级功能（可选）

- 节点连线（react-flow 集成，用于故事结构流程图）
- 版本历史（方案 B：独立 `studio_canvas` 表 + version 字段）
- 协作评审（需要 tldraw Cloud 或自建 WebSocket 同步层）

### 数据流

```
用户进入 StudioDetailPage → CanvasEditor 懒加载
    ↓
GET /api/studio/projects/:id/canvas → 返回 canvas_data
    ↓
CanvasEditor 加载 canvas_data 到 tldraw store
    ↓
用户绘制 / 标注 / 拖入素材图章
    ↓
editor.store.listen() → isDirty = true → 防抖 3s
    ↓
editor.store.getSnapshot() → PATCH /api/studio/projects/:id/canvas
    ↓
后端校验大小（UTF-8 编码字节数 ≤ `SAU_STUDIO_CANVAS_MAX_SIZE`，默认 10 MiB UTF-8 字节 = 10,485,760 bytes；见 `specs/canvas-editor/spec.md` 第一个 Requirement）+ owner 鉴权 → UPDATE canvas_data
    ↓
保存成功 → isDirty = false
```

## Capabilities

### New Capabilities

- `canvas-editor`: 基于 tldraw 的无限画布编辑器——故事板绘制、素材标注、灵感草图、画布数据持久化与导出

### Modified Capabilities

- `script-engine`:`studio_projects` 表新增 `canvas_data` 列；新增 `GET/PATCH /api/studio/projects/{id}/canvas` 端点（懒加载，不随项目详情返回）
- `script-viewer`:`StudioDetailPage` 在分集列表与素材列表之间嵌入 `CanvasEditor` 区块

## Impact

+ **CLI**: 无变更（纯 Web 端新增）
+ **Web API**:
  - 修改 `web_runner/routes/studio.py`：新增 `GET /api/studio/projects/{id}/canvas`（懒加载画布数据）+ `PATCH /api/studio/projects/{id}/canvas`（保存画布）端点
  - 修改 `web_runner/db.py`：`_init_db_sqlite` alterations + `_init_db_postgres` alteration_statements 新增 `canvas_data` 列（SQLite `TEXT` ↔ PG `JSONB`，沿用已有 `ALTER TABLE` 幂等迁移模式）
+ **Frontend**:
  - 新增 `src/Components/Studio/CanvasEditor.tsx`（tldraw 封装 + 懒加载 + 自动保存）
  - 新增 `src/Components/Studio/TldrawWrapper.tsx`（tldraw 实例管理 + 数据加载）
  - 新增 `src/Components/Studio/CanvasActions.tsx`（保存 / 导出 / 清空按钮）
  - 修改 `src/api/studio.ts`：新增 `studioApi.getCanvas(id)` + `studioApi.saveCanvas(id, data)` 方法
  - 修改 `src/Pages/StudioDetailPage.tsx`：嵌入 `CanvasEditor` 区块（懒加载，不随项目详情加载画布数据）
  - 修改 `package.json`：新增 `tldraw` 依赖
+ **Database**:
  - `studio_projects` 新增 `canvas_data TEXT` (SQLite) / `canvas_data JSONB` (PostgreSQL)
  - 双方言同步（沿用 `script-studio` 已有的 `_init_db_sqlite` + `_init_db_postgres` 模式）
+ **依赖**:
  - Frontend: 新增 `tldraw@^2.x`（~200KB gzip，原生 React 组件）
  - Python: 无新增依赖
+ **配置**:
  - 新增可选 `SAU_STUDIO_CANVAS_MAX_SIZE`（默认 10 MiB UTF-8 字节 = 10,485,760 bytes；**单位是 UTF-8 编码字节数**，不是 Python `str` 字符数；度量公式 `len(json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))`，详见 `specs/canvas-editor/spec.md` + `.env.example`）
+ **Breaking**: 无（`canvas_data` 默认 NULL，不影响现有项目 CRUD；GET 响应新增字段，前端向后兼容）
