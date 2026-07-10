## Context

当前 SAU Web 端已有完整的用户认证体系（邮箱验证码登录）和角色系统（admin/user），但缺少管理员专用界面。创始人想知道"谁在用我的项目"，只能去查数据库。

现有架构：
- 后端：Flask `create_app()` 工厂模式，`web_runner/routes/` 下 Blueprint 注册
- 前端：React 19 + React Router v7 + Zustand + TanStack Query + axios `client.ts`
- 数据库：SQLite（开发）/ PostgreSQL（生产），`web_runner/db.py` 双方言初始化
- UI 组件库：shadcn/ui（Radix UI + Tailwind CSS v4），已有 Button/Input/Dialog/Card 等 30+ 组件
- 认证：邮箱验证码登录，Flask session，`@login_required` + `@admin_required` 装饰器

详细设计文档见：`docs/DESIGN-admin-dashboard.md`

## Goals / Non-Goals

**Goals:**
- 管理员可以通过 Web 界面查看用户列表、操作日志、系统状态
- 管理员可以管理用户角色（admin/user）
- 用户可以通过 Google/GitHub 账号一键登录
- 保持现有邮箱验证码登录不变（向后兼容）
- 复用现有 shadcn/ui 组件，不引入新 UI 框架
- 按用户价值划分版本（v0.1 看到用户 → v0.2 看到操作 → v0.3 看到系统 → v1.0 完整管理 → v1.1 社交登录）

**Non-Goals:**
- 不做用户会话管理（查看在线用户、强制下线）
- 不做系统配置 UI（SMTP、CORS、配额阈值等）
- 不做 License 管理页面
- 不做导出功能（CSV 导出）
- 不做图表增强（7天活跃趋势）
- 不迁移技术栈到 TanStack Start（保持 Flask + React 架构）

## Decisions

### 1. Admin Dashboard 架构

**选择**：
- 后端：新建 `web_runner/routes/admin.py` 蓝图，所有端点使用 `@admin_required` 装饰器
- 前端：新建 `src/features/admin/` 目录，包含 3 个页面组件 + 1 个 API 客户端
- 路由：`/app/admin/*` 路由组，侧边栏按 `authUser?.role === 'admin'` 条件渲染

**理由**：
- 与现有架构一致（Blueprint + 页面组件）
- `@admin_required` 装饰器已存在，可直接复用
- 条件渲染确保普通用户看不到管理入口

**实现**：
```python
# web_runner/routes/admin.py
@bp.get('/api/admin/overview')
@admin_required
def get_overview():
    # 聚合统计：总用户数、今日活跃、任务成功率
    pass

@bp.get('/api/admin/users')
@admin_required
def get_users():
    # 增强版用户列表，含操作统计
    pass

@bp.get('/api/admin/audit')
@admin_required
def get_audit_logs():
    # 操作审计日志
    pass

@bp.get('/api/admin/system')
@admin_required
def get_system():
    # 系统状态：任务统计、错误分布
    pass
```

### 2. 审计日志设计

**选择**：新增 `admin_audit_log` 表，记录管理员操作

**理由**：
- 安全审计需要记录谁在什么时候做了什么
- 角色变更是敏感操作，必须有审计记录
- 表结构简单，与现有表风格一致

**实现**：
```sql
CREATE TABLE admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    target_user_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (admin_user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
);
```

### 2.1 GET /api/admin/system 响应格式

**Response**：
```json
{
  "success": true,
  "data": {
    "tasks_by_status": {
      "success": 1100,
      "failed": 80,
      "pending": 54
    },
    "tasks_by_platform": {
      "douyin": 500,
      "xiaohongshu": 400,
      "bilibili": 334
    },
    "errors_by_type": {
      "TimeoutError": 30,
      "CookieExpired": 25,
      "UploadFailed": 25
    }
  }
}
```

### 3. 社交登录技术选型

**选择**：Authlib（Python OAuth 库）

**理由**：
- Flask 原生支持，API 简洁
- 支持 OpenID Connect（Google 登录需要）
- 社区活跃，文档完善
- 比 Flask-OAuthlib 更现代（后者已废弃）

**替代方案**：
- better-auth（Node.js 库）→ 拒绝（项目是 Python Flask 后端，无法直接使用）
- 直接实现 OAuth 流程 → 拒绝（重复造轮子，容易出错）

**实现**：
```python
# web_runner/oauth.py
from authlib.integrations.flask_client import OAuth

oauth = OAuth()

oauth.register(
    name='google',
    client_id='your-google-client-id',
    client_secret='your-google-client-secret',
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)
```

### 4. 登录页面设计

**选择**：社交登录按钮 + 分割线 + 邮箱验证码登录

**理由**：
- 社交登录放在最前面（推荐方式）
- 分割线明确区分两种登录方式
- 保留邮箱验证码登录作为备选

**实现**：
```tsx
// 登录页面布局
<div>
  <Button onClick={googleLogin}>Google 登录</Button>
  <Button onClick={githubLogin}>GitHub 登录</Button>
  <Separator>或者使用</Separator>
  <EmailLoginForm />
</div>
```

### 5. 版本规划

**选择**：按用户价值划分版本，而不是技术层

**理由**：
- 用户能感受到价值，而不是技术实现
- 每个版本都能交付可用功能
- 便于优先级排序和资源分配

**版本**：
- v0.1：看到用户（3h）— 管理员能知道"谁注册了" ✅ 已完成
- v0.2：看到操作（4.5h）— 管理员能知道"谁做了什么" ✅ 已完成
- v0.3：看到系统（4.5h）— 管理员能知道"系统运行得怎么样" ✅ 已完成
- v1.0：完整管理（6h）— 管理员能完整管理用户和系统 ✅ 已完成（核心功能：角色变更 + 审计 + 禁止自降级）
- v1.1：社交登录（5h）— 用户可以用 Google/GitHub 一键登录 ✅ 已完成

> **实现状态**：v0.1–v1.1 全部核心功能已实现并测试通过（后端 pytest 41 测试 + 前端 Vitest 22 测试）。
> 未完成的可选增强项：审计日志时间范围筛选、用户列表搜索/前端分页/角色筛选、文档（README/环境配置指南）。

### 6. 组件复用策略

**选择**：100% 复用现有 shadcn/ui 组件

**理由**：
- 减少包体积，不引入新依赖
- 保持与现有页面风格统一
- 降低维护成本，只需维护一套组件

**复用清单**：
- `Table` → 用户列表、操作日志
- `Card` → 概览统计卡片、容器
- `Stat` → 数字统计展示
- `Badge` → 角色标签（admin/user）
- `EmptyState` → 空数据提示
- `Skeleton` → 加载状态
- `Button` → 操作按钮
- `DropdownMenu` → 角色变更下拉菜单
- `Dialog` → 角色变更确认弹窗
- `Toast` → 操作反馈

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| 概览页聚合查询慢 | v0.3 先用实时查询，用户量 >100 时考虑预计算 |
| 审计日志表膨胀 | 永久保留（审计需要），不做自动清理 |
| OAuth 回调失败 | 前端显示错误提示，支持重试 |
| Google/GitHub API 限制 | 使用官方 SDK，遵循速率限制 |
| 自身角色降级 | 后端禁止管理员把自己从 admin 降为 user |
| 审计日志被篡改 | 表不暴露 DELETE 端点，不可删除 |

## Migration Plan

1. **Phase 1 — v0.1 看到用户** ✅：侧边栏管理员入口 → AdminUsersPage（纯表格）
2. **Phase 2 — v0.2 看到操作** ✅：admin_audit_log 表 → AdminAuditPage → 角色变更写入审计日志
3. **Phase 3 — v0.3 看到系统** ✅：概览 API → AdminOverviewPage（数字卡片 + 最近操作）
4. **Phase 4 — v1.0 完整管理** ✅：角色变更功能（DropdownMenu + AlertDialog 二次确认） → 审计日志分页 → 禁止自降级
5. **Phase 5 — v1.1 社交登录** ✅：Authlib 集成 → Google/GitHub 登录路由 → 登录页面按钮

回滚策略：每个版本独立，回滚只需删除对应文件/代码，不影响其他功能

## Open Questions

- [x] 是否需要支持更多社交登录（Apple、Discord、微信）？→ Google/GitHub 已满足 MVP 需求，后续按需扩展
- [ ] 审计日志是否需要支持时间范围筛选（v1.0+ 考虑）？→ 已实现 server-side 分页，时间筛选为可选增强
- [ ] 概览页是否需要图表（v1.0+ 考虑）？→ 当前为数字卡片 + 表格，图表为可选增强
- [ ] `.env.example` 是否需要补充 OAuth 配置说明？→ 待补充文档
- [ ] `README.md` 是否需要更新 Admin Dashboard + 社交登录使用说明？→ 待补充文档
