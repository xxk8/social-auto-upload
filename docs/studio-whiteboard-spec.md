# Studio 白板功能技术方案

> 本文档详细分析现有 Studio 页面架构，并给出集成无限画布（白板）功能的完整技术方案。

---

## 一、现有架构分析

### 1.1 系统定位

Studio（剧本工坊）是 social-auto-upload 项目中的内容创作模块，核心目标是：

- 把一句话灵感变成多集剧本
- 围绕 synopsis 持续生成候选分集
- 挑出值得拍的那几集一键导出 Seedance 2.0 分镜
- 渲染成 9:16 竖屏成片（Remotion Node 桥接，1080×1920 H264 MP4 + 同步 Edge-TTS 配音 MP3）

### 1.2 技术栈全景

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层                                    │
├─────────────────────────────────────────────────────────────────┤
│  React 18 + TypeScript                                          │
│  Vite 构建工具                                                   │
│  TanStack Query (数据请求 + 缓存)                                │
│  React Router v6 (路由)                                         │
│  Tailwind CSS + shadcn/ui (UI 组件库)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP REST API (JSON)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        后端层                                    │
├─────────────────────────────────────────────────────────────────┤
│  Flask (Python WSGI 框架)                                       │
│  Flask-CORS (跨域支持)                                          │
│  Blueprint 模块化路由                                           │
│  SQLite / PostgreSQL (双数据库支持)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Python 函数调用
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        渲染层                                    │
├─────────────────────────────────────────────────────────────────┤
│  Remotion Node bridge (`@remotion/renderer` 满载 chromium)        │
│  edge-tts CLI (语音合成 → MP3)                                     │
│  Pexels Videos CDN (背景视频素材，下载到 `media/studio/<id>/media/`) │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 数据库表结构

#### studio_projects（项目表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PRIMARY KEY | 自增主键 |
| title | TEXT NOT NULL | 项目标题（最多80字符） |
| synopsis | TEXT NOT NULL | 一句话灵感/梗概（最多500字符） |
| style | TEXT | 风格标签（可选） |
| status | TEXT DEFAULT 'draft' | 状态：draft / generating / ready / exported |
| owner_user_id | INTEGER NOT NULL | 所属用户 ID |
| created_at | TEXT NOT NULL | 创建时间（ISO 8601） |
| updated_at | TEXT NOT NULL | 更新时间（ISO 8601） |

#### studio_episodes（分集表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PRIMARY KEY | 自增主键 |
| project_id | INTEGER NOT NULL | 所属项目 ID（FK CASCADE） |
| episode_no | INTEGER NOT NULL | 集数编号 |
| act | TEXT NOT NULL | 结构：起 / 承 / 转 / 合 |
| title | TEXT NOT NULL | 分集标题 |
| scenes_json | TEXT (JSON) | 场景列表（JSON 字符串） |
| dialogues_json | TEXT (JSON) | 台词列表（JSON 字符串） |
| status | TEXT DEFAULT 'draft' | 状态：draft / generating / complete |
| created_at | TEXT NOT NULL | 创建时间 |

**唯一约束**: UNIQUE (project_id, episode_no)

#### studio_assets（素材表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PRIMARY KEY | 自增主键 |
| project_id | INTEGER NOT NULL | 所属项目 ID（FK CASCADE） |
| kind | TEXT NOT NULL | 类型：character / scene / prop |
| code | TEXT NOT NULL | 素材编码 |
| name | TEXT NOT NULL | 素材名称 |
| prompt | TEXT NOT NULL | AI 生成提示词 |
| ref_image_url | TEXT | 参考图片 URL（可选） |
| created_at | TEXT NOT NULL | 创建时间 |

**唯一约束**: UNIQUE (project_id, kind, code)

### 1.4 API 接口清单

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|---|---|---|---|---|
| POST | /api/studio/projects | 创建项目 | `{title, synopsis, style?}` | 项目对象 |
| GET | /api/studio/projects | 列出当前用户所有项目 | - | 项目数组 |
| GET | /api/studio/projects/:id | 获取项目详情 | - | 项目 + 分集 + 素材 |
| PATCH | /api/studio/projects/:id | 更新项目 | `{title?, synopsis?, style?}` | 项目对象 |
| DELETE | /api/studio/projects/:id | 删除项目 | - | `{id}` |
| POST | /api/studio/projects/:id/render | 渲染成片 | - | 视频 URL + 字幕 |

### 1.5 前端页面结构

#### StudioPage（项目列表页）

```
┌─────────────────────────────────────────────────┐
│  剧本工坊                                        │
│  把一句话灵感变成多集剧本...                        │
│                                                  │
│  [+ 新建剧本题材]                                 │
├─────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ 项目 1   │  │ 项目 2   │  │ 项目 3   │         │
│  │ 标题     │  │ 标题     │  │ 标题     │         │
│  │ 状态     │  │ 状态     │  │ 状态     │         │
│  │ 更新时间 │  │ 更新时间 │  │ 更新时间 │         │
│  └─────────┘  └─────────┘  └─────────┘         │
└─────────────────────────────────────────────────┘
```

#### StudioDetailPage（项目详情页）

```
┌─────────────────────────────────────────────────┐
│  ← 返回剧本工坊                                   │
├─────────────────────────────────────────────────┤
│  项目标题                              [编辑] [草稿]│
│  风格标签                                          │
│  ─────────────────────────────────────────────── │
│  一句话灵感 / 梗概                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ 这里是梗概内容...                              │ │
│  └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│  成片                                              │
│  ┌─────────────────────────────────────────────┐ │
│  │  [视频播放器]                                  │ │
│  │  下载字幕 (.srt) 下载字幕 (.ass)               │ │
│  └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│  分集 (3)                                          │
│  ┌─────────────────────────────────────────────┐ │
│  │ [起] 第 1 集 · 开端                           │ │
│  │      2 个场景 · 5 条台词                       │ │
│  ├─────────────────────────────────────────────┤ │
│  │ [承] 第 2 集 · 发展                           │ │
│  │      3 个场景 · 8 条台词                       │ │
│  └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│  素材 (2)                                          │
│  ┌──────────┐  ┌──────────┐                      │
│  │ 角色      │  │ 场景      │                      │
│  │ 主角      │  │ 城市街道  │                      │
│  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────┘
```

### 1.6 现有数据流

```
用户操作                        前端                         后端                      数据库
   │                            │                           │                         │
   ├─ 点击「新建剧本题材」 ──────►│                           │                         │
   │                            ├─ 弹出创建对话框 ──────────►│                         │
   │                            │  填写标题/梗概/风格        │                         │
   │                            │                           │                         │
   ├─ 点击「确认」 ──────────────►│                           │                         │
   │                            ├─ useMutation.mutate() ───►│                         │
   │                            │  POST /api/studio/projects │                         │
   │                            │                           ├─ _validate_create_payload()
   │                            │                           ├─ db.insert_returning_id()
   │                            │                           │  INSERT INTO studio_projects
   │                            │                           │                         │
   │                            │◄── {success, data} ───────┤                         │
   │                            ├─ invalidateQueries() ────►│                         │
   │                            │  重新拉取项目列表          │                         │
   │                            │                           │                         │
   ├─ 点击项目卡片 ──────────────►│                           │                         │
   │                            ├─ navigate(/dashboard/studio/1) ─►│                         │
   │                            │                           │                         │
   │                            ├─ useQuery({               │                         │
   │                            │    queryKey: ['studio-project', 1],                  │
   │                            │    queryFn: () => studioApi.getProject(1)            │
   │                            │  }) ──────────────────────►│                         │
   │                            │                           ├─ GET /api/studio/projects/1
   │                            │                           ├─ SELECT * FROM studio_projects
   │                            │                           ├─ SELECT * FROM studio_episodes
   │                            │                           ├─ SELECT * FROM studio_assets
   │                            │                           │                         │
   │                            │◄── {success, data} ───────┤                         │
   │                            │  data = {                 │                         │
   │                            │    ...project,            │                         │
   │                            │    episodes: [...],       │                         │
   │                            │    assets: [...]          │                         │
   │                            │  }                        │                         │
```

---

## 二、白板功能需求分析

### 2.1 用户场景

用户在 Studio 中需要：

1. **故事板绘制**：用图形化方式绘制分镜脚本，标注镜头运动、人物走位
2. **流程图设计**：用节点+连线的方式设计故事结构（起承转合）
3. **灵感草图**：快速涂鸦记录灵感，不需要精确
4. **素材标注**：在画布上标注角色、场景、道具的位置和关系
5. **协作评审**：多人在画布上讨论和修改（未来需求）

### 2.2 功能边界

| 功能 | 优先级 | 说明 |
|---|---|---|
| 基础绘图（形状、线条、文字） | P0 | 必须 |
| 画布缩放/平移 | P0 | 必须 |
| 图片插入 | P0 | 必须 |
| 撤销/重做 | P0 | 必须 |
| 导出 PNG/SVG | P1 | 重要 |
| 自定义图章（角色、场景） | P1 | 重要 |
| 节点连线（流程图） | P2 | 可选 |
| 实时协作 | P3 | 未来 |
| 版本历史 | P3 | 未来 |

### 2.3 技术约束

1. **轻量化**：不能引入过重的依赖，影响打包体积
2. **React 原生**：必须是 React 组件，能无缝嵌入现有页面
3. **数据持久化**：画布数据需要保存到数据库
4. **离线可用**：画布操作不应依赖网络
5. **性能**：大量图形元素时不能卡顿

---

## 三、开源方案对比

### 3.1 候选方案

| 方案 | 包大小 | 协议 | React 支持 | 特点 |
|---|---|---|---|---|
| **tldraw** | ~200KB | 定制协议 | 原生 React | 最轻量，专为嵌入设计 |
| **Excalidraw** | ~400KB | MIT | React 组件 | 手绘风格，协作支持 |
| **react-flow** | ~150KB | MIT | 原生 React | 节点连线图 |
| **Konva.js** | ~100KB | MIT | react-konva | 底层 Canvas 库 |
| **Fabric.js** | ~300KB | MIT | 需封装 | 功能丰富的 Canvas 库 |

### 3.2 方案评估

#### tldraw（推荐）

**优势**：
- 最轻量（~200KB gzip），不影响打包体积
- 原生 React 组件，`<Tldraw />` 一行嵌入
- 内置形状、文字、箭头、图片、橡皮擦
- 支持自定义工具栏和工具
- 导出 PNG/SVG/JSON
- 活跃维护，文档完善
- 数据模型清晰，易于持久化

**劣势**：
- 协议非标准 MIT（tldraw license）
- 不支持节点连线（需要额外开发）
- 协作功能需要 tldraw Cloud（付费）

**适用场景**：故事板绘制、灵感草图、素材标注

#### Excalidraw

**优势**：
- 手绘风格，视觉独特
- MIT 协议，完全开源
- 支持实时协作（Excalidraw+）
- 导出 PNG/SVG/JSON
- 社区活跃，插件丰富

**劣势**：
- 包体积较大（~400KB）
- 手绘风格可能不适合所有场景
- 嵌入需要额外配置

**适用场景**：需要手绘风格的场景、团队协作

#### react-flow

**优势**：
- 专为节点连线图设计
- 原生 React，类型完善
- 支持自定义节点和边
- 性能优秀，支持大量节点
- MIT 协议

**劣势**：
- 不支持自由绘图
- 不适合故事板场景
- 需要自己实现布局算法

**适用场景**：故事结构流程图、依赖关系图

#### Konva.js / Fabric.js

**优势**：
- 底层 Canvas 库，完全可控
- 功能丰富，性能优秀
- 可以实现任何自定义功能

**劣势**：
- 需要大量自行开发
- 不是 React 组件，需要封装
- 开发成本高

**适用场景**：需要完全定制的场景

### 3.3 推荐方案

**主方案：tldraw**

理由：
1. 最轻量，不影响现有打包体积
2. 原生 React，嵌入成本最低
3. 功能覆盖 80% 的故事板需求
4. 数据模型清晰，易于持久化
5. 可以通过插件机制扩展

**补充方案：react-flow**

用于实现故事结构流程图（起承转合的节点连线），作为 tldraw 的补充。

---

## 四、集成方案设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  StudioDetailPage                                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  项目信息    │  │  分集列表    │  │  素材列表    │             │
│  │  (现有)      │  │  (现有)      │  │  (现有)      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  画布编辑器 (新增)                                           ││
│  │  ┌─────────────────────────────────────────────────────┐   ││
│  │  │  tldraw                                             │   ││
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │   ││
│  │  │  │ 工具栏   │  │ 画布     │  │ 属性面板 │            │   ││
│  │  │  │         │  │         │  │         │            │   ││
│  │  │  │ 选择    │  │         │  │ 填充    │            │   ││
│  │  │  │ 画笔    │  │  ←→     │  │ 描边    │            │   ││
│  │  │  │ 形状    │  │  拖拽    │  │ 文字    │            │   ││
│  │  │  │ 文字    │  │  缩放    │  │         │            │   ││
│  │  │  │ 图片    │  │         │  │         │            │   ││
│  │  │  └─────────┘  └─────────┘  └─────────┘            │   ││
│  │  └─────────────────────────────────────────────────────┘   ││
│  │                                                             ││
│  │  [保存画布]  [导出 PNG]  [导出 SVG]  [清空画布]              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 数据模型扩展

#### 方案 A：新增字段（推荐）

在 `studio_projects` 表新增 `canvas_data` 字段：

```sql
ALTER TABLE studio_projects ADD COLUMN canvas_data TEXT;
```

**优势**：
- 简单直接，改动最小
- 画布数据与项目 1:1 关系，逻辑清晰
- 删除项目时自动清理画布数据

**劣势**：
- 单个字段存储大量 JSON，可能影响查询性能
- 无法单独版本控制画布数据

#### 方案 B：新增独立表

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

**优势**：
- 画布数据独立管理
- 支持版本历史
- 可以单独备份/迁移

**劣势**：
- 多一次关联查询
- 需要维护额外的表

#### 推荐：方案 A

理由：
1. 当前阶段不需要版本历史
2. 画布数据与项目是强绑定关系
3. 实现简单，改动最小
4. 性能问题可以后续优化（如懒加载）

### 4.3 API 扩展

#### 保存画布

```
PATCH /api/studio/projects/:id/canvas

Request:
{
  "canvas_data": {
    "shapes": [...],
    "bindings": [...],
    "assets": [...]
  }
}

Response:
{
  "success": true,
  "data": {
    "id": 1,
    "updated_at": "2026-07-07T10:00:00Z"
  }
}
```

#### 获取画布

画布数据随项目详情一起返回：

```
GET /api/studio/projects/:id

Response:
{
  "success": true,
  "data": {
    "id": 1,
    "title": "项目标题",
    "canvas_data": {
      "shapes": [...],
      "bindings": [...],
      "assets": [...]
    },
    "episodes": [...],
    "assets": [...]
  }
}
```

### 4.4 前端组件结构

```
src/
├── Components/
│   └── Studio/
│       ├── ProjectList.tsx           # 项目列表（现有）
│       ├── ProjectCreateDialog.tsx   # 创建对话框（现有）
│       ├── CanvasEditor.tsx          # 画布编辑器（新增）
│       │   ├── TldrawWrapper.tsx     # tldraw 封装
│       │   ├── CanvasToolbar.tsx     # 自定义工具栏
│       │   └── CanvasActions.tsx     # 保存/导出按钮
│       └── ScriptViewer.tsx          # 剧本查看器（Phase 2）
└── Pages/
    ├── StudioPage.tsx               # 项目列表页（现有）
    └── StudioDetailPage.tsx         # 项目详情页（修改）
```

### 4.5 交互流程

#### 加载画布

```
1. 用户进入 StudioDetailPage
2. useQuery 调用 GET /api/studio/projects/:id
3. 返回 project.canvas_data
4. CanvasEditor 接收 canvas_data 作为 prop
5. tldraw 通过 editor.store.put() 加载数据
6. 画布渲染完成
```

#### 保存画布

```
1. 用户点击「保存画布」或自动保存（防抖）
2. 调用 editor.store.getSnapshot() 获取当前状态
3. 序列化为 JSON
4. 调用 PATCH /api/studio/projects/:id/canvas
5. 后端更新 studio_projects.canvas_data
6. 返回成功，更新 updated_at
```

#### 导出画布

```
1. 用户点击「导出 PNG」
2. 调用 editor.toImage() 或 editor.getSvg()
3. 生成 Blob 或 Data URL
4. 触发下载或复制到剪贴板
```

### 4.6 状态管理

#### 前端状态

```typescript
// CanvasEditor 组件状态
interface CanvasEditorState {
  // tldraw 编辑器引用
  editor: Editor | null
  
  // 画布数据（从服务端加载）
  canvasData: CanvasData | null
  
  // 保存状态
  isSaving: boolean
  lastSavedAt: string | null
  
  // 是否有未保存的修改
  isDirty: boolean
}

// CanvasData 类型定义
interface CanvasData {
  shapes: Record<string, TLShape>
  bindings: Record<string, TLBinding>
  assets: Record<string, TLAsset>
}
```

#### 自动保存策略

```
1. 用户操作触发 editor.store.listen()
2. 检测到变化后设置 isDirty = true
3. 启动防抖计时器（3秒）
4. 计时器结束后自动保存
5. 保存成功后 isDirty = false
6. 页面离开前检查 isDirty，提示用户保存
```

---

## 五、性能优化

### 5.1 画布数据优化

1. **增量保存**：只保存变化的部分，而非整个画布
2. **压缩存储**：使用 msgpack 或 protobuf 替代 JSON
3. **懒加载**：大型画布分块加载

### 5.2 渲染优化

1. **虚拟化**：只渲染视口内的元素
2. **WebGL 加速**：使用 GPU 加速渲染
3. **离屏 Canvas**：静态元素缓存到离屏 Canvas

### 5.3 内存优化

1. **图片压缩**：上传前压缩图片
2. **资源释放**：组件卸载时释放 tldraw 实例
3. **垃圾回收**：定期清理未使用的资源

---

## 六、安全考虑

### 6.1 数据验证

1. **后端验证**：检查 canvas_data 结构是否合法
2. **大小限制**：限制 canvas_data 最大 10MB
3. **类型检查**：确保所有字段类型正确

### 6.2 权限控制

1. **所有者隔离**：只有项目所有者可以编辑画布
2. **读写分离**：查看者只能读取，不能修改
3. **API 鉴权**：所有 API 调用都需要登录

### 6.3 防攻击

1. **XSS 防护**：对用户输入的文字进行转义
2. **CSRF 防护**：使用 Token 验证
3. **速率限制**：限制 API 调用频率

---

## 七、实施计划

### 7.1 Phase 1：基础集成（1-2 周）

- [ ] 安装 tldraw 依赖
- [ ] 实现 CanvasEditor 组件
- [ ] 扩展数据库 schema
- [ ] 实现保存/加载 API
- [ ] 集成到 StudioDetailPage

### 7.2 Phase 2：功能增强（2-3 周）

- [ ] 自定义工具栏
- [ ] 导出 PNG/SVG
- [ ] 自动保存
- [ ] 自定义图章（角色、场景）

### 7.3 Phase 3：高级功能（3-4 周）

- [ ] 节点连线（react-flow 集成）
- [ ] 版本历史
- [ ] 协作评审
- [ ] 性能优化

---

## 八、风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| tldraw 协议变更 | 中 | 锁定版本，定期评估替代方案 |
| 画布数据过大 | 中 | 实施大小限制，优化存储格式 |
| 性能问题 | 高 | 虚拟化渲染，WebGL 加速 |
| 兼容性问题 | 低 | 充分测试，渐进式集成 |

---

## 九、总结

本方案基于现有 Studio 架构，采用 tldraw 作为白板引擎，通过最小改动实现无限画布功能。核心设计原则：

1. **轻量优先**：选择最轻量的方案，不影响现有功能
2. **渐进增强**：分阶段实施，降低风险
3. **数据驱动**：画布数据与项目绑定，便于管理和同步
4. **性能优先**：从设计阶段就考虑性能优化

预期效果：用户可以在 Studio 中直接绘制故事板、标注素材、设计流程图，大幅提升内容创作效率。
