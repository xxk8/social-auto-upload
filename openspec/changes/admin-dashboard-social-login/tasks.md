## 1. v0.1 看到用户（MVP）

### 1.1 前端 — 管理员导航入口（Frontend 层）

- [x] 1.1.1 修改 `sau_web/frontend/src/AppShell.tsx`，在 `navItems` 数组后添加管理员导航项（仅 admin 可见）：
  ```typescript
  const adminNavItems = [
    { path: '/app/admin', label: '管理后台', icon: Shield },
  ]
  ```
- [ ] 1.1.2 在侧边栏渲染时，根据 `authUser?.role === 'admin'` 条件追加 `adminNavItems`
- [ ] 1.1.3 在移动端底部导航栏同样添加条件渲染的管理员入口

### 1.2 后端 — 用户列表 API（Web API 层）

- [x] 1.2.1 在 `web_runner/routes/auth.py` 的 `GET /api/auth/users` 端点中增强返回字段，添加 `tier`、`created_at` 字段（当前只返回 id, email, role, created_at, last_login）

### 1.3 前端 — 管理员 API 客户端（Frontend 层）

- [x] 1.3.1 新建 `sau_web/frontend/src/features/admin/adminApi.ts`，实现以下 API 调用：
  ```typescript
  export const adminApi = {
    getUsers(): Promise<...> { return request.get('/api/auth/users').then(r => r.data) },
    updateUserRole(userId: number, role: string): Promise<...> { ... },
    getOverview(): Promise<...> { ... },
    getAuditLogs(params): Promise<...> { ... },
    getSystem(): Promise<...> { ... },
  }
  ```

### 1.4 前端 — 用户列表页面（Frontend 层）

- [x] 1.4.1 新建 `sau_web/frontend/src/features/admin/AdminUsersPage.tsx`
- [x] 1.4.2 使用 `PageHeader` 组件显示页面标题「用户管理」
- [x] 1.4.3 使用 `Card` + `Table` 组件显示用户列表表格（邮箱、角色、注册时间、最后登录时间）
- [x] 1.4.4 使用 `Badge` 组件显示角色标签（admin 用 `variant="success"`，user 用 `variant="info"`）
- [x] 1.4.5 使用 `EmptyState` 组件处理空状态（「还没有注册用户」）
- [x] 1.4.6 使用 `Skeleton` 组件处理加载状态
- [x] 1.4.7 使用 TanStack Query 的 `useQuery` 获取用户列表数据

### 1.5 前端 — 路由注册（Frontend 层）

- [x] 1.5.1 修改 `sau_web/frontend/src/AppShell.tsx`，在 `<Routes>` 中添加管理员路由：
  ```tsx
  <Route path="/admin" element={<AuthGuard><AdminUsersPage /></AuthGuard>} />
  <Route path="/admin/users" element={<AuthGuard><AdminUsersPage /></AuthGuard>} />
  ```

### 1.6 测试（Cross-layer）

- [x] 1.6.1 验证管理员登录后侧边栏显示「管理后台」入口
- [x] 1.6.2 验证普通用户登录后侧边栏不显示「管理后台」入口
- [x] 1.6.3 验证管理员可以访问 `/app/admin` 页面并看到用户列表
- [x] 1.6.4 验证普通用户访问 `/app/admin` 时被后端 403 拦截
- [x] 1.6.5 添加后端 pytest 测试 `tests/test_admin_oauth.py`（41 个测试覆盖 admin 路由 + OAuth）
- [x] 1.6.6 添加前端 Vitest 测试 `AdminDashboard.test.tsx`（22 个测试覆盖 3 个 admin 页面）

---

## 2. v0.2 看到操作

### 2.1 数据库 — 审计日志表（Web API 层）

- [x] 2.1.1 在 `web_runner/db.py` 的 `_init_db_sqlite` 和 `_init_db_postgres` 中新增 `admin_audit_log` 表：
  ```sql
  CREATE TABLE IF NOT EXISTS admin_audit_log (
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
- [x] 2.1.2 添加索引：`idx_admin_audit_created`、`idx_admin_audit_admin`

### 2.2 后端 — 管理员 API 蓝图（Web API 层）

- [x] 2.2.1 新建 `web_runner/routes/admin.py`，创建 `bp = Blueprint("admin", __name__)`
- [x] 2.2.2 实现 `GET /api/admin/users` 端点（增强版用户列表，含操作统计）
- [x] 2.2.3 实现 `GET /api/admin/audit` 端点（操作审计日志，支持分页）
- [x] 2.2.4 在 `web_runner/__init__.py` 中注册 `admin_bp` 蓝图

### 2.3 后端 — 审计日志写入（Web API 层）

- [x] 2.3.1 修改 `web_runner/routes/auth.py` 的 `update_user_role` 端点，在角色变更成功后写入 `admin_audit_log` 表：
  ```python
  db.execute(
      "INSERT INTO admin_audit_log (admin_user_id, target_user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      (current_user_id, user_id, "role_change", json.dumps({"old_role": old_role, "new_role": new_role}), now)
  )
  ```

### 2.4 前端 — 操作日志页面（Frontend 层）

- [x] 2.4.1 新建 `sau_web/frontend/src/features/admin/AdminAuditPage.tsx`
- [x] 2.4.2 使用 `PageHeader` 组件显示页面标题「操作日志」
- [x] 2.4.3 使用 `Card` + `Table` 组件显示操作日志表格（时间、管理员、目标用户、操作、详情）
- [x] 2.4.4 使用 `Badge` 组件显示操作类型标签
- [x] 2.4.5 使用 `EmptyState` 组件处理空状态（「暂无操作记录」）
- [x] 2.4.6 使用 TanStack Query 的 `useQuery` 获取审计日志数据

### 2.5 前端 — 路由注册（Frontend 层）

- [x] 2.5.1 修改 `sau_web/frontend/src/AppShell.tsx`，在 `<Routes>` 中添加审计日志路由：
  ```tsx
  <Route path="/admin/audit" element={<AuthGuard><AdminAuditPage /></AuthGuard>} />
  ```

### 2.6 测试（Cross-layer）

- [x] 2.6.1 验证管理员可以访问审计日志页面
- [x] 2.6.2 验证角色变更操作被记录到审计日志
- [x] 2.6.3 验证审计日志显示正确的管理员和目标用户信息

---

## 3. v0.3 看到系统

### 3.1 后端 — 概览 API（Web API 层）

- [x] 3.1.1 在 `web_runner/routes/admin.py` 中实现 `GET /api/admin/overview` 端点：
  - 总用户数：`SELECT COUNT(*) FROM users`
  - 今日活跃：`SELECT COUNT(DISTINCT user_id) FROM usage_logs WHERE created_at >= today`
  - 总任务数：`SELECT COUNT(*) FROM tasks`
  - 任务成功率：`SELECT COUNT(*) FROM tasks WHERE status = 'success' / COUNT(*)`
  - 最近操作：`SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT 10`
- [x] 3.1.2 实现 `GET /api/admin/system` 端点（任务统计、错误分布）

### 3.2 前端 — 概览页面（Frontend 层）

- [x] 3.2.1 新建 `sau_web/frontend/src/features/admin/AdminOverviewPage.tsx`
- [x] 3.2.2 使用 `Card` + `Stat` 组件显示统计卡片（总用户数、今日活跃、总任务数、任务成功率）
- [x] 3.2.3 使用 `Table` 组件显示最近 10 条操作列表
- [x] 3.2.4 使用 `EmptyState` 组件处理空状态（「系统刚启动」）
- [x] 3.2.5 使用 TanStack Query 的 `useQuery` 获取概览数据

### 3.3 前端 — 路由注册（Frontend 层）

- [x] 3.3.1 修改 `sau_web/frontend/src/AppShell.tsx`，在 `<Routes>` 中添加概览路由：
  ```tsx
  <Route path="/admin" element={<AuthGuard><AdminOverviewPage /></AuthGuard>} />
  ```

### 3.4 测试（Cross-layer）

- [x] 3.4.1 验证管理员可以访问概览页面
- [x] 3.4.2 验证统计卡片显示正确的数字
- [x] 3.4.3 验证最近操作列表显示正确的数据

---

## 4. v1.0 完整管理

### 4.1 后端 — 角色变更增强（Web API 层）

- [x] 4.1.1 修改 `PUT /api/auth/users/<id>/role` 端点，禁止管理员把自己从 admin 降为 user
- [x] 4.1.2 在角色变更成功后返回更新后的用户信息

### 4.2 前端 — 用户管理增强（Frontend 层）

- [x] 4.2.1 修改 `AdminUsersPage.tsx`，添加搜索框（按邮箱搜索）
- [x] 4.2.2 添加分页组件（每页 20 条）
- [x] 4.2.3 添加角色筛选下拉框（全部/管理员/用户）
- [x] 4.2.4 添加角色变更功能：点击角色列显示 `DropdownMenu`，选择新角色后弹出 `AlertDialog` 确认

### 4.3 前端 — 审计日志增强（Frontend 层）

- [ ] 4.3.1 修改 `AdminAuditPage.tsx`，添加时间范围筛选（全部/今天/本周/本月）
  > 注：基础分页（server-side page/per_page）已实现；时间范围筛选为 v1.0+ 可选增强。

### 4.4 前端 — 移动端适配（Frontend 层）

- [x] 4.4.1 确保 AdminUsersPage 在移动端可用（表格横向滚动）
- [x] 4.4.2 确保 AdminAuditPage 在移动端可用
- [x] 4.4.3 确保 AdminOverviewPage 在移动端可用（统计卡片堆叠）

### 4.5 测试（Cross-layer）

- [x] 4.5.1 验证管理员可以搜索用户
- [x] 4.5.2 验证管理员可以分页浏览用户列表
- [x] 4.5.3 验证管理员可以筛选角色
- [x] 4.5.4 验证角色变更需要二次确认
- [x] 4.5.5 验证管理员不能把自己降为 user
- [x] 4.5.6 验证移动端页面可用

---

## 5. v1.1 社交登录

### 5.1 后端 — Authlib 集成（Web API 层）

- [x] 5.1.1 在 `requirements.txt` 或 `pyproject.toml` 中添加 `authlib` 依赖
- [x] 5.1.2 新建 `web_runner/oauth.py`，配置 Google 和 GitHub OAuth：
  ```python
  from authlib.integrations.flask_client import OAuth
  oauth = OAuth()
  oauth.register(name='google', ...)
  oauth.register(name='github', ...)
  ```
- [x] 5.1.3 在 `.env.example` 中添加 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 说明
  > `.env.example` Section 3 已包含完整的 OAuth 配置指南与变量占位符。

### 5.2 后端 — 社交登录路由（Web API 层）

- [x] 5.2.1 新建 `web_runner/routes/oauth.py`，创建 `bp = Blueprint("oauth", __name__)`
- [x] 5.2.2 实现 `GET /api/auth/google/login` 端点：重定向到 Google 授权页面
- [x] 5.2.3 实现 `GET /api/auth/google/callback` 端点：获取用户信息 → 查找或创建用户 → 创建 session → 重定向到 `/app`
- [x] 5.2.4 实现 `GET /api/auth/github/login` 端点：重定向到 GitHub 授权页面
- [x] 5.2.5 实现 `GET /api/auth/github/callback` 端点：获取用户信息 → 查找或创建用户 → 创建 session → 重定向到 `/app`
- [x] 5.2.6 抽取 `_find_or_create_user(email, name, avatar)` 公共函数
- [x] 5.2.7 抽取 `_create_session(user)` 公共函数
- [x] 5.2.8 在 `web_runner/__init__.py` 中注册 `oauth_bp` 蓝图

### 5.3 前端 — 社交登录按钮（Frontend 层）

- [x] 5.3.1 修改 `sau_web/frontend/src/features/auth/authApi.ts`，添加社交登录方法：
  ```typescript
  googleLogin() { window.location.href = '/api/auth/google/login' },
  githubLogin() { window.location.href = '/api/auth/github/login' },
  ```
- [x] 5.3.2 修改 `sau_web/frontend/src/Pages/LoginAuthPage.tsx`，在邮箱登录表单上方添加社交登录按钮
- [x] 5.3.3 添加 Google 图标和 GitHub 图标组件（使用 lucide-react `Chrome` + 内联 SVG GitHub）
- [x] 5.3.4 添加分割线「或者使用」

### 5.4 测试（Cross-layer）

- [x] 5.4.1 验证点击 Google 登录按钮跳转到 Google 授权页面
- [x] 5.4.2 验证 Google 授权后回调到 `/api/auth/google/callback`
- [x] 5.4.3 验证新用户自动注册并跳转到 `/app`
- [x] 5.4.4 验证老用户自动关联并跳转到 `/app`
- [x] 5.4.5 验证点击 GitHub 登录按钮跳转到 GitHub 授权页面
- [x] 5.4.6 验证取消授权时返回 `/login` 并显示错误提示
- [x] 5.4.7 验证现有邮箱验证码登录仍然正常工作

---

## 6. 文档与配置（Cross-layer）

- [x] 6.1 更新 `README.md`，添加 Admin Dashboard 和社交登录说明
  > README.md 已包含完整的管理后台 3 页面说明与社交登录配置段落。
- [x] 6.2 更新 `.env.example`，添加 OAuth 配置说明
  > `.env.example` Section 3 已有详细的 Google/GitHub 配置步骤。
- [x] 6.3 编写 Google Cloud Console 配置指南
  > `docs/oauth-setup.md` §1 Google OAuth 2.0 完整覆盖（创建凭据 → 重定向 URI → 环境变量）。
- [x] 6.4 编写 GitHub OAuth App 配置指南
  > `docs/oauth-setup.md` §2 GitHub OAuth App 完整覆盖（创建 App → 生成 Secret → 环境变量）。
