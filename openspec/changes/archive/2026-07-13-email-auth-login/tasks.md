## 1. 基础设施 — SECRET_KEY 与 CORS（Web API 层）

- [x] 1.1 在 `web_runner/__init__.py` 的 `create_app()` 中实现 `_get_secret_key()` 函数：优先读 `SAU_SECRET_KEY` 环境变量 → 读 `db/.secret_key` 文件 → 自动生成随机 key 写入文件（权限 600）→ 设置 `app.config["SECRET_KEY"]`
- [x] 1.2 在 `_setup_cors()` 中为 `CORS()` 添加 `supports_credentials=True` 参数，确保跨域请求携带 cookie
- [x] 1.3 在 `.env.example` 中添加 `SAU_SECRET_KEY` 说明

## 2. Database — 新增认证表（Web API 层）

- [x] 2.1 在 `web_runner/db.py` 中为 SQLite 和 PostgreSQL 双方言新增 `users` 表（id, email UNIQUE, role DEFAULT 'user', created_at, last_login, login_attempts, locked_until）— 注意：无 password_hash 列，本系统仅验证码登录
- [x] 2.2 在 `web_runner/db.py` 中新增 `verification_codes` 表（id, email, code, expires_at, used BOOLEAN DEFAULT false, created_at）
- [x] 2.3 在 `_init_db_sqlite` 和 `_init_db_postgres` 的 `alterations` 列表中添加新表创建语句，确保向后兼容

## 3. Backend Auth — 邮件发送与验证码（Web API 层）

- [x] 3.1 新建 `web_runner/routes/auth.py`，创建 `bp = Blueprint("auth", __name__)`
- [x] 3.2 实现 `_send_smtp_email(to_email, subject, body)` 工具函数，读取 `SAU_SMTP_*` 环境变量，通过 `smtplib.SMTP_SSL` 发送邮件；SMTP 未配置时返回明确错误
- [x] 3.3 实现 `POST /api/auth/send-code` 端点：验证邮箱格式 → 清理同 email 过期验证码 → 检查 60 秒限频 → 生成 6 位验证码 → 写入 `verification_codes` 表 → 调用 `_send_smtp_email` → 返回成功/失败
- [x] 3.4 实现 `POST /api/auth/login` 端点：验证邮箱+验证码 → 检查过期/已用/锁定 → 用 `db.transaction()` 包裹「检查用户数 → 插入新用户（首个为 admin）」防竞态 → 清除旧 session 创建新 session（防 session fixation）→ 更新 `last_login` → 返回用户信息
- [x] 3.5 实现 `POST /api/auth/logout` 端点：清除 session → 返回成功
- [x] 3.6 实现 `GET /api/auth/me` 端点：从 session 读取 user_id → 查询用户表 → 返回用户信息（未登录返回 401）
- [x] 3.7 实现 `GET /api/auth/users` 端点（admin only）：查询所有用户列表
- [x] 3.8 实现 `PUT /api/auth/users/<id>/role` 端点（admin only）：修改用户角色
- [x] 3.9 实现 `GET /api/auth/sse-token` 端点：生成一次性 UUID token，存入 `verification_codes` 表（purpose='sse'，5 分钟过期），返回 `{ token, expires_in }`

## 4. Backend Auth — 登录保护装饰器（Web API 层）

- [x] 4.1 实现 `@login_required` 装饰器函数，检查 `session.get("user_id")`，未登录返回 401 JSON 响应
- [x] 4.2 实现 `@admin_required` 装饰器函数，检查 `session.get("role") == "admin"`，非 admin 返回 403
- [x] 4.3 实现 `SAU_AUTH_ENABLED` 开关：仅在 `FLASK_DEBUG=1` 或 `FLASK_ENV=development` 时允许 `SAU_AUTH_ENABLED=false` 跳过认证；生产环境忽略此开关
- [x] 4.4 在 `create_app()` 中注册 `auth_bp` 蓝图
- [x] 4.5 在 `create_app()` 中添加 `@app.before_request` 钩子，对 `/api/*` 路径（白名单 `/api/auth/*`、`/health` 除外）执行登录检查
- [x] 4.6 在 `create_app()` 启动时执行 `DELETE FROM verification_codes WHERE expires_at < now` 清理过期验证码

## 5. Backend Auth — SSE 端点认证适配（Web API 层）

- [x] 5.1 修改 `web_runner/routes/accounts.py` 的 `/api/accounts/login/sse` 端点：支持 `sse_token` query param 认证（校验 token 有效性 + 标记已用），同时保留 session cookie 认证路径
- [x] 5.2 修改 `web_runner/routes/upload.py` 的 SSE 进度端点：同上，支持 `sse_token` query param
- [x] 5.3 修改 `web_runner/routes/ai.py` 的 SSE 流式端点：同上，支持 `sse_token` query param
- [x] 5.4 抽取 `_authenticate_sse_request(request)` 公共函数：检查 session → 检查 sse_token → 返回 user_id 或 None

## 6. Frontend Auth — API 与状态管理（Frontend 层）

- [x] 6.1 安装 `react-hook-form`、`zod`、`@hookform/resolvers` 依赖
- [x] 6.2 修改 `src/api/client.ts` 的 `axios.create()` 添加 `withCredentials: true`
- [x] 6.3 修改 `src/api/client.ts` 的所有 `fetch()` 调用（AI 流式相关 3 处）添加 `credentials: 'include'`
- [x] 6.4 新建 `src/features/auth/authApi.ts`，实现 `sendCode(email)`、`login(email, code)`、`logout()`、`getMe()`、`getUsers()`、`updateUserRole(id, role)`、`getSseToken()` API 调用函数
- [x] 6.5 新建 `src/features/auth/authStore.ts`（Zustand store），管理 `user`、`isAuthenticated`、`isLoading` 状态，提供 `setUser`、`clearAuth`、`checkAuth` actions
- [x] 6.6 新建 `src/features/auth/useAuth.ts` hook，封装 `authStore` + TanStack Query 的 `useQuery` 调用 `getMe()`，提供 `login`、`logout`、`sendCode` mutation hooks
- [x] 6.7 修改 `src/api/client.ts` 的 axios response interceptor，检测 401 响应时调用 `authStore.clearAuth()` 并 `window.location.href = '/login'`

## 7. Frontend Auth — 登录页面（Frontend 层）

- [x] 7.1 新建 `src/features/auth/LoginPage.tsx`，使用 shadcn/ui 的 `Card`、`Input`、`Button`、`Label`、`Alert` 组件构建登录表单
- [x] 7.2 实现两步表单：第一步输入邮箱 + 发送验证码按钮（60 秒倒计时），第二步输入 6 位验证码 + 登录按钮
- [x] 7.3 使用 `react-hook-form` + `zod` 做表单验证（邮箱格式、验证码 6 位数字）
- [x] 7.4 登录成功后跳转到 `/`，使用 `react-router-dom` 的 `useNavigate`
- [x] 7.5 新建 `src/features/auth/AuthGuard.tsx` 组件，检查 `useAuth()` 的 `isAuthenticated` 状态，未登录时 `<Navigate to="/login" />`，已登录时渲染 `children`

## 8. Frontend Auth — SSE 调用改造（Frontend 层）

- [x] 8.1 修改 `src/Components/LoginProgressModal.tsx`：在打开 EventSource 前先调 `getSseToken()` 获取 token，拼到 SSE URL 的 query param 中
- [x] 8.2 修改 `src/api/client.ts` 中 AI 流式 `fetch` 调用：如果是 SSE 类请求，先获取 sse_token 拼到 URL
- [x] 8.3 确保 Vite proxy 模式下 SSE 调用正常工作（同源时 session cookie 自动带，不需要 token）

## 9. Frontend Auth — 路由与布局集成（Frontend 层）

- [x] 9.1 修改 `src/App.tsx`，用 `AuthGuard` 包裹所有受保护路由（`/`、`/publish`、`/tasks`、`/logs`）
- [x] 9.2 在 `App.tsx` 的 `<Routes>` 中添加 `<Route path="/login" element={<LoginPage />}>`
- [x] 9.3 修改 `App.tsx` 的 `AppShell` 侧边栏 footer，显示当前用户邮箱 + "登出" 按钮（使用 shadcn/ui `Button` + `DropdownMenu`）
- [x] 9.4 在 `App` 组件顶层添加 `useAuth()` 的 `checkAuth` 初始化调用（应用加载时检查 session）
- [x] 9.5 确保 `/login` 路由在已登录状态下自动重定向到 `/`

## 10. 测试与文档（Cross-layer）

- [x] 10.1 更新 `tests/test_web_shell.py` 的 `app` fixture：添加 `app.config["SECRET_KEY"] = "test"` 和辅助 `login_as_admin(client)` helper
- [x] 10.2 编写 `web_runner/routes/auth.py` 的 pytest 单元测试：send-code 限频、login 验证码校验、session 设置、admin 权限检查、首个管理员竞态、SSE token 生成与校验
- [x] 10.3 更新 `README.md` 和 `.env.example`，添加 SECRET_KEY / SMTP 配置说明和首次管理员创建指引
- [x] 10.4 端到端手动测试：SMTP 发送 → 验证码输入 → 登录成功 → 侧边栏显示用户 → 登出 → 401 重定向 → SSE 带 token 连接
