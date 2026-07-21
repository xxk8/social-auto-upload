## 1. Phase 1 — 基础白板集成

> **Archive status (2026-Q3):** Phase 1 backend is implemented and tested (DB migrations + canvas GET/PATCH endpoints + 13 pytest scenarios in `tests/test_studio_canvas.py`). The frontend pieces (1.3–1.6, 1.7.1–1.7.3, 1.7.6) and Phase 2–3 are **deferred to a follow-up change** and are NOT covered by this archive. The 4 schema-agnostic Scenarios under Requirement 5 are preserved verbatim in the canonical spec.

### 1.1 数据库 — canvas_data 列(Database 层)

- [x] 1.1.1 在 `web_runner/db.py:_init_db_sqlite` 的 `alterations` 列表中追加 `ALTER TABLE studio_projects ADD COLUMN canvas_data TEXT`（包在已有的 `try/except sqlite3.OperationalError: pass` 循环中，列已存在时幂等跳过）
- [x] 1.1.2 在 `web_runner/db.py:_init_db_postgres` 的 `alteration_statements` 列表中追加 `ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS canvas_data JSONB`（PG 9.6+ 原生幂等）
- [x] 1.1.3 验证双方言：本地 SQLite 启动后 `PRAGMA table_info(studio_projects)` 查看列；`SAU_DB_DIALECT=postgres` 启动后 `psql \d+ studio_projects` 验证 PG schema
- [x] 1.1.4 验证现有项目 CRUD 不受影响：`canvas_data` 默认 NULL，GET 项目详情响应不包含该字段（懒加载）

### 1.2 后端 — 画布保存 API(Web API 层)

- [x] 1.2.1 在 `web_runner/routes/studio.py` 中实现 `GET /api/studio/projects/{id}/canvas`：owner 鉴权 → `SELECT canvas_data FROM studio_projects WHERE id = ? AND owner_user_id = ?` → 返回 `{ canvas_data }`（`db.json_load` 解码，NULL → null）
- [x] 1.2.2 在 `web_runner/routes/studio.py` 中实现 `PATCH /api/studio/projects/{id}/canvas`，Body 接 `{ canvas_data }`
- [x] 1.2.3 校验 `canvas_data` 是 JSON 对象（或 null 清空）；序列化后大小 ≤ `SAU_STUDIO_CANVAS_MAX_SIZE`（默认 10 MiB UTF-8 字节 = 10,485,760 bytes，注意是 **MiB** 不是 MB——避免 operator 误读），**必须用 UTF-8 编码字节数度量**：`len(json.dumps(canvas_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))`。`ensure_ascii=False` + `separators=(",", ":")` 必填，让后端产出的 JSON 字节流与前端 `JSON.stringify` + `TextEncoder().encode()` 一致（`specs/canvas-editor/spec.md` 第 1 / 3 个 Requirement 详述原因）；用 `len(json.dumps(...))`（默认 `ensure_ascii=True` + `(", ", ": ")`）会产生额外空格 + 转义，CJK 多时体积可偏差 30%+，与前端预检边界不一致。
- [x] 1.2.4 owner 鉴权复用 `_load_project(user_id, project_id)`，非 owner → 404
- [x] 1.2.5 成功后 `UPDATE studio_projects SET canvas_data = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?`，返回 `{ id, updated_at }`
- [x] 1.2.6 添加后端 pytest `tests/test_studio_canvas.py`：GET/PATCH 鉴权 / 大小限制 / 非 owner 404 / null 清空

### 1.3 前端 — 安装 tldraw 依赖(Frontend 层)

- [ ] 1.3.1 在 `sau_web/frontend/` 下安装 `tldraw@^2.x`（`pnpm add tldraw`）
- [ ] 1.3.2 验证打包体积：`pnpm build` 后用 `vite-bundle-visualizer` 确认 tldraw chunk ~200KB 且不在主 bundle

### 1.4 前端 — API 客户端扩展(Frontend 层)

- [ ] 1.4.1 在 `sau_web/frontend/src/api/studio.ts` 中新增 `studioApi.getCanvas(id)` 方法（GET `/api/studio/projects/${id}/canvas` → 返回 `{ canvas_data }`）
- [ ] 1.4.2 在 `sau_web/frontend/src/api/studio.ts` 中新增 `studioApi.saveCanvas(id, canvasData)` 方法（PATCH `/api/studio/projects/${id}/canvas`）
- [ ] 1.4.3 定义 `CanvasData` 类型（tldraw v2 `TldrawSnapshot` 的前端类型声明：`{ schema: number, store: { records: Record<string, unknown> } }`）

### 1.5 前端 — CanvasEditor 组件(Frontend 层)

- [ ] 1.5.1 新建 `sau_web/frontend/src/Components/Studio/TldrawWrapper.tsx`：封装 `<Tldraw />`，管理 editor 实例 + 数据加载（`editor.store.put()`）
- [ ] 1.5.2 新建 `sau_web/frontend/src/Components/Studio/CanvasEditor.tsx`：接收 `projectId` prop，内部 `useQuery(['studio-canvas', projectId])` 调用 `studioApi.getCanvas` 懒加载画布数据，管理 isDirty / isSaving / lastSavedAt 状态
- [ ] 1.5.3 实现 `editor.store.listen()` → `isDirty = true` → 防抖 3s → `editor.store.getSnapshot()` → `studioApi.saveCanvas()` 自动保存
- [ ] 1.5.4 保存失败时自动重试 3 次 + Toast「保存失败，正在重试」+ isDirty 保持 true
- [ ] 1.5.5 实现 `beforeunload` 事件：`isDirty` 时触发浏览器原生离开提示
- [ ] 1.5.6 新建 `sau_web/frontend/src/Components/Studio/CanvasActions.tsx`：保存状态指示 + 「保存」手动按钮 + 「清空画布」确认对话框

### 1.6 前端 — StudioDetailPage 集成(Frontend 层)

- [ ] 1.6.1 修改 `sau_web/frontend/src/Pages/StudioDetailPage.tsx`：在分集列表与素材列表之间嵌入 `CanvasEditor` 区块
- [ ] 1.6.2 `CanvasEditor` 用 `lazy(() => import('...'))` 懒加载，tldraw 不进入主 bundle
- [ ] 1.6.3 `CanvasEditor` 内部独立 `useQuery(['studio-canvas', projectId])` 拉取画布数据（不随项目详情加载）
- [ ] 1.6.4 保存成功后 `invalidateQueries(['studio-canvas', projectId])` 刷新画布数据缓存

### 1.7 测试(Cross-layer)

- [ ] 1.7.1 验证进入 StudioDetailPage 后画布区块加载，空项目时显示空白画布
- [ ] 1.7.2 验证 `CanvasEditor` 懒加载后画布内容渲染；绘制形状后 3 秒内自动保存，刷新页面后画布内容恢复
- [ ] 1.7.3 验证离开页面时有未保存修改时触发浏览器离开提示
- [x] 1.7.4 验证非 owner 调用 `PATCH /canvas` 返回 404
- [x] 1.7.5 验证画布数据超 `SAU_STUDIO_CANVAS_MAX_SIZE`（默认 10 MiB UTF-8 字节 = 10,485,760 bytes，见任务 1.2.3）时返回 400 + 前端 Toast 提示；用 11 MiB UTF-8 编码后的 CJK-heavy payload 验证（≈ 3.7 MiB 字符经 UTF-8 编码后超 10 MiB）
- [ ] 1.7.6 添加前端 Vitest `CanvasEditor.test.tsx`：加载数据 / 自动保存防抖 / isDirty 离开提示

---

## 2. Phase 2 — 功能增强

### 2.1 前端 — 自定义工具栏(Frontend 层)

- [ ] 2.1.1 用 tldraw `components` prop 自定义工具栏，精简为：选择 / 画笔 / 矩形 / 椭圆 / 箭头 / 文字 / 图片 / 橡皮擦
- [ ] 2.1.2 新建 `sau_web/frontend/src/Components/Studio/CanvasToolbar.tsx`：故事板场景专用工具栏
- [ ] 2.1.3 隐藏 tldraw 默认的菜单 / 页面管理 / 分享按钮（减少视觉干扰）

### 2.2 前端 — 导出功能(Frontend 层)

- [ ] 2.2.1 实现「导出 PNG」：`editor.toImage()` → Blob → `<a download>` 触发下载
- [ ] 2.2.2 实现「导出 SVG」：`editor.getSvg()` → SVG 字符串 → Blob → 下载
- [ ] 2.2.3 在 `CanvasActions` 中添加导出按钮下拉菜单

### 2.3 前端 — 素材图章(Frontend 层)

- [ ] 2.3.1 实现自定义 `AssetStampShape`（tldraw custom shape）：带 asset code + name + prompt 元数据
- [ ] 2.3.2 从 `AssetPlanner` 拖拽角色/场景/道具卡片到画布 → 创建 `AssetStampShape`
- [ ] 2.3.3 点击画布上的图章 → 高亮 `ScriptViewer` 中引用该 asset 的镜头（复用 `data-asset={code}` 选择器）
- [ ] 2.3.4 图章显示 asset 编号（C01 / S01 / P01）+ 名称 + 参考图（若有 `ref_image_url`）

### 2.4 测试(Cross-layer)

- [ ] 2.4.1 验证自定义工具栏只显示 8 个工具按钮
- [ ] 2.4.2 验证导出 PNG 文件可正常打开
- [ ] 2.4.3 验证从 AssetPlanner 拖拽到画布创建图章 + 点击图章高亮对应镜头
- [ ] 2.4.4 添加前端 Vitest：导出流程 + 图章创建 + 交叉高亮

---

## 3. Phase 3 — 高级功能（可选）

### 3.1 前端 — react-flow 流程图(Frontend 层)

- [ ] 3.1.1 安装 `reactflow` 依赖
- [ ] 3.1.2 新建 `sau_web/frontend/src/Components/Studio/StoryFlowChart.tsx`：用 react-flow 展示故事结构（起承转合节点连线）
- [ ] 3.1.3 节点从 `studio_episodes` 自动生成，边表示集与集之间的叙事关系

### 3.2 数据库 — 版本历史(Database 层)

- [ ] 3.2.1 新建 `studio_canvas` 表（方案 B）：`id / project_id UNIQUE / data / version / created_at / updated_at`
- [ ] 3.2.2 修改 `PATCH /canvas` 端点：每次保存 `version + 1`，保留历史版本
- [ ] 3.2.3 新增 `GET /api/studio/projects/{id}/canvas/versions` 列出版本历史

### 3.3 前端 — 版本历史 UI(Frontend 层)

- [ ] 3.3.1 在 `CanvasActions` 中添加「版本历史」按钮 → 弹出版本列表 Sheet
- [ ] 3.3.2 点击历史版本 → 预览该版本画布快照
- [ ] 3.3.3 「恢复到此版本」按钮 → 将该版本设为当前

### 3.4 测试(Cross-layer)

- [ ] 3.4.1 验证流程图节点与分集数据同步
- [ ] 3.4.2 验证版本历史保存 / 列出 / 恢复流程
- [ ] 3.4.3 添加前后端测试覆盖 Phase 3 功能

---

## 4. 文档与配置(Cross-layer)

- [ ] 4.1 在 `docs/studio-whiteboard-spec.md` 已有方案文档基础上，补充实施后的使用说明
- [ ] 4.2 `.env.example` 已新增「10. Studio 白板」section（SAU_STUDIO_CANVAS_MAX_SIZE，默认 10485760 字节 = 10 MiB UTF-8 字节）—— 任务完成，无需再动
- [ ] 4.3 更新 `docs/dev/INDEX.md`，添加「Studio 白板」入口
- [ ] 4.4 在 `README.md` 剧本工坊段落补充画布功能说明
